-- 26/10/2026 — Etapa 2 (UX). Aplicado em PROD via MCP.

-- 1) propor_troca: o mínimo de 50.000 passa a valer por (time de origem, time de destino, ANO) somando as
--    fatias — a tela agora mostra 1 linha de multa por ano e reparte o valor entre as linhas de origem.
do $mig$
declare d text; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='propor_troca';
  n := (length(d) - length(replace(d, 'for v_chk in', ''))) / length('for v_chk in');
  if n <> 1 then raise exception 'esperava 1 loop v_chk, achei %', n; end if;
  -- (a) por item: só valida valor positivo
  if position($a$if v_amt is null or v_amt < 50000 then raise exception 'Fatia de multa mínima é 50.000 (enviado).'; end if;$a$ in d) = 0
    then raise exception 'padrao a nao encontrado'; end if;
  d := replace(d, $a$if v_amt is null or v_amt < 50000 then raise exception 'Fatia de multa mínima é 50.000 (enviado).'; end if;$a$,
                  $a$if v_amt is null or v_amt <= 0 then raise exception 'Valor de multa inválido.'; end if;$a$);
  -- (b) mínimo por origem/destino/ano, antes da checagem de saldo
  d := replace(d, $b$  for v_chk in
    select (e->>'source_penalty_id')::uuid src$b$,
$b$  for v_chk in
    select it.fr, it.tt, it.sid, sum(it.amt) tot
    from (
      select (e->>'from_team_id')::uuid fr, (e->>'to_team_id')::uuid tt,
             (select tp.season_id from public.team_penalties tp where tp.id = (e->>'source_penalty_id')::uuid) sid,
             (e->>'amount')::bigint amt
      from jsonb_array_elements(_itens) e
      where e->>'asset_type' = 'penalty'
    ) it
    group by it.fr, it.tt, it.sid
    having sum(it.amt) < 50000
  loop
    raise exception 'Multa enviada por ano precisa ser de no mínimo 50.000 (enviado: %).', v_chk.tot;
  end loop;

  for v_chk in
    select (e->>'source_penalty_id')::uuid src$b$);
  execute d;
end $mig$;

-- 2) get_movimentacoes_pagina: pick agora vem com o time de origem ("2ª · 28/29 · de Floripa Waves")
do $mig$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_movimentacoes_pagina';
  if position($a$(dp.round::text || 'ª · ' || coalesce(ds.label, '—'))$a$ in d) = 0 then raise exception 'padrao pick nao encontrado'; end if;
  if position($b$left join public.seasons ds on ds.id = dp.draft_season_id$b$ in d) = 0 then raise exception 'padrao join nao encontrado'; end if;
  d := replace(d, $a$(dp.round::text || 'ª · ' || coalesce(ds.label, '—'))$a$,
                  $a$(dp.round::text || 'ª · ' || coalesce(ds.label, '—') || ' · de ' || coalesce(ot.name, '—'))$a$);
  d := replace(d, $b$left join public.seasons ds on ds.id = dp.draft_season_id$b$,
                  $b$left join public.seasons ds on ds.id = dp.draft_season_id
      left join public.teams ot on ot.id = dp.original_team_id$b$);
  execute d;
end $mig$;

-- 3) consolidar_escalacoes_pendentes_v2: mesma regra da original, mas devolve jsonb detalhado por time e
--    aceita _dry=true (simula e desfaz — mostra quem será preenchido e onde haverá buraco, sem gravar).
create or replace function public.consolidar_escalacoes_pendentes_v2(_season_id uuid, _week integer, _dry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_game       record;
  v_src_lineup uuid;
  v_new_lineup uuid;
  v_slot       record;
  v_rows       jsonb := '[]'::jsonb;
  v_cop        integer;
  v_bur        integer;
  v_det        jsonb;
  v_tname      text;
  v_pname      text;
  v_pos        text;
  v_out        jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin pode consolidar as escalações.';
  end if;

  if not exists (
    select 1 from public.roster_locks rl
    where rl.season_id = _season_id and rl.week_number = _week and now() >= rl.locks_at
  ) then
    raise exception 'Consolidação só é permitida após o prazo (locks_at) da semana %.', _week;
  end if;

  begin
    for v_game in
      select g.id as game_id, g.game_number_in_week, t.team_id
      from public.games g
      cross join lateral (values (g.home_team_id), (g.away_team_id)) as t(team_id)
      where g.season_id = _season_id and g.week_number = _week and g.is_playoff = false
        and not exists (select 1 from public.matchup_lineups ml where ml.game_id = g.id and ml.team_id = t.team_id)
      order by g.game_number_in_week, g.id
    loop
      select name into v_tname from public.teams where id = v_game.team_id;

      select ml.id into v_src_lineup
      from public.matchup_lineups ml
      join public.games g on g.id = ml.game_id
      where ml.team_id = v_game.team_id and g.is_playoff = false
      order by g.played_on desc nulls last, g.week_number desc, g.game_number_in_week desc
      limit 1;

      if v_src_lineup is null then
        v_rows := v_rows || jsonb_build_object('team_id', v_game.team_id, 'team', v_tname,
          'game', v_game.game_number_in_week, 'sem_modelo', true, 'copiados', 0, 'buracos', 0, 'detalhe', '[]'::jsonb);
        continue;
      end if;

      insert into public.matchup_lineups (game_id, team_id) values (v_game.game_id, v_game.team_id)
      returning id into v_new_lineup;

      v_cop := 0; v_bur := 0; v_det := '[]'::jsonb;
      for v_slot in
        select ls.position_id, ls.slot_type, ls.player_id
        from public.lineup_slots ls where ls.lineup_id = v_src_lineup
      loop
        begin
          insert into public.lineup_slots (lineup_id, position_id, slot_type, player_id)
          values (v_new_lineup, v_slot.position_id, v_slot.slot_type, v_slot.player_id);
          v_cop := v_cop + 1;
        exception when others then
          v_bur := v_bur + 1;
          select full_name into v_pname from public.players where id = v_slot.player_id;
          select code into v_pos from public.positions where id = v_slot.position_id;
          v_det := v_det || jsonb_build_object('jogador', coalesce(v_pname, '?'), 'posicao', v_pos, 'slot', v_slot.slot_type);
        end;
      end loop;

      v_rows := v_rows || jsonb_build_object('team_id', v_game.team_id, 'team', v_tname,
        'game', v_game.game_number_in_week, 'sem_modelo', false, 'copiados', v_cop, 'buracos', v_bur, 'detalhe', v_det);
    end loop;

    if _dry then
      raise exception using errcode = 'P0DRY', message = 'dry-run';
    end if;
  exception when sqlstate 'P0DRY' then
    null; -- desfaz tudo o que foi inserido; v_rows permanece
  end;

  with t as (select r->>'team' as team, r from jsonb_array_elements(v_rows) r)
  select jsonb_build_object(
    'dry', _dry,
    'teams', coalesce(jsonb_agg(jsonb_build_object(
        'team', s.team, 'jogos', s.jogos, 'copiados', s.copiados, 'buracos', s.buracos,
        'sem_modelo', s.sem_modelo, 'detalhe', s.detalhe) order by s.team), '[]'::jsonb))
  into v_out
  from (
    select t.team,
           count(*) as jogos,
           sum((t.r->>'copiados')::int) as copiados,
           sum((t.r->>'buracos')::int) as buracos,
           bool_and((t.r->>'sem_modelo')::boolean) as sem_modelo,
           (select coalesce(jsonb_agg(d.value), '[]'::jsonb)
              from t t2, jsonb_array_elements(t2.r->'detalhe') d(value)
             where t2.team = t.team) as detalhe
    from t
    group by t.team
  ) s;

  return v_out;
end;
$fn$;
