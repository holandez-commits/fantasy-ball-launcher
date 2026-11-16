-- =====================================================================
-- Sessão 22 (16/11/2026) — Mínimo de 12 jogadores ativos + contratação automática
-- =====================================================================
-- Regra (dono):
--  * Depois do leilão de FA, todo time com < 12 ATIVOS (IR não conta) recebe
--    automaticamente o "último dispensado" que ninguém contratou, contrato de
--    1 ano, US$ 750.000, até chegar a 12.
--  * Ordem dos times: menos ativos -> pior aproveitamento (V/J) -> nome (A-Z);
--    recalculada a cada contratação.
--  * Candidatos: QUALQUER dispensado da temporada que esteja fora de elenco, do
--    mais recente (transactions.created_at da dispensa) ao mais antigo; pula quem o
--    próprio time dispensou na temporada; "vai voltando" até preencher.
--  * Nenhum time pode ficar < 12 sem cap livre para a contratação automática:
--    dispensa, troca e IR são bloqueados (proposta E execução/fila).
--
-- Estratégia de aplicação: funções grandes são PATCHEADAS por replace() sobre
-- pg_get_functiondef (falha alto se a âncora não existir; idempotente pelo guard
-- 'elenco_minimo_viola'). Funções pequenas vêm completas.
-- Tudo é transacional (pode ser rodado dentro de BEGIN ... ROLLBACK).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Helpers
-- ---------------------------------------------------------------------

-- posição conhecida do jogador: elenco mais recente > snapshot da dispensa > foto semanal
create or replace function public.posicao_conhecida(_player uuid)
returns text
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select re.position from public.roster_entries re
      where re.player_id = _player and re.position is not null
      order by re.season desc limit 1),
    (select t.email_snapshot->>'pos'
       from public.transactions t
       join public.transaction_items ti on ti.transaction_id = t.id and ti.asset_type = 'player'
      where t.type = 'release' and ti.player_id = _player and t.email_snapshot->>'pos' is not null
      order by t.created_at desc limit 1),
    (select w.position from public.weekly_rosters w
      where w.player_id = _player and w.position is not null
      order by w.created_at desc limit 1)
  );
$$;

-- true = VIOLA o mínimo: abaixo de 12 ativos e sem cap livre para (12 - ativos) x 750K
create or replace function public.elenco_minimo_viola(_slots_after integer, _available_after bigint)
returns boolean
language sql immutable
as $$
  select _slots_after < 12 and _available_after < 750000::bigint * (12 - _slots_after);
$$;

create or replace function public.elenco_minimo_msg(_team text, _slots integer, _avail bigint)
returns text
language sql immutable
as $$
  select format('%s ficaria com %s jogador(es) ativo(s) e cap livre de $%s. Abaixo de 12 ativos é preciso ter $%s livres para a contratação automática (mínimo de $750,000 por vaga).',
                _team, _slots, to_char(_avail, 'FM999,999,999,999'),
                to_char(750000::bigint * greatest(12 - _slots, 0), 'FM999,999,999,999'));
$$;

-- efeito, no cap da temporada corrente, de dispensar a entrada _re_id:
--   salary = salário que sai; multa = multa gerada (mesma regra de executar_dispensa_core,
--   incluindo isenção de calouro nos 2 últimos anos). Só a fatia da temporada corrente mexe no cap.
create or replace function public.dispensa_efeito(_re_id uuid)
returns table(salary bigint, multa bigint)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_label text; v_n integer; v_i integer; v_sal bigint; v_cal boolean; v_pct numeric; v_multa bigint := 0;
begin
  select label into v_label from public.seasons where is_current = true;
  select coalesce(re.contrato_calouro, false) into v_cal from public.roster_entries re where re.id = _re_id;
  select count(*) into v_n from public.roster_contract_years cy where cy.roster_entry_id = _re_id;
  select x.rn, x.salary into v_i, v_sal
    from (select cy.season_label, cy.salary, row_number() over (order by cy.season_label) rn
            from public.roster_contract_years cy where cy.roster_entry_id = _re_id) x
   where x.season_label = v_label;
  if v_sal is null then
    return query select 0::bigint, 0::bigint; return;
  end if;
  if not (v_cal and v_i > v_n - 2) then
    v_pct := public.multa_pct(v_sal);
    if v_pct > 0 then
      v_multa := (round((v_sal * v_pct) / 50000.0) * 50000)::bigint;
    end if;
  end if;
  return query select v_sal, v_multa;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Dispensa: bloqueio na proposta (inclui a fila de dispensas já aprovadas do time)
-- ---------------------------------------------------------------------
create or replace function public.propor_dispensa(_player_id uuid, _week integer default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_gm         uuid := public.current_gm_id();
  v_team       uuid := public.current_team_id();
  v_season_id  uuid;
  v_season_int integer;
  v_tx         uuid;
  v_open       boolean;
  v_re         uuid;
  v_re2        uuid;
  v_ef         record;
  v_q          record;
  v_dslots     integer := -1;
  v_davail     bigint;
  v_n          integer;
  v_av         bigint;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  select re.id into v_re
  from public.roster_entries re
  where re.team_id = v_team and re.player_id = _player_id
    and re.season = v_season_int and re.status = 'active';
  if v_re is null then
    raise exception 'Jogador não está no elenco ativo do seu time.';
  end if;

  -- já existe dispensa pendente/na fila desse jogador?
  if exists (
    select 1 from public.transactions t
    join public.transaction_items ti on ti.transaction_id = t.id and ti.asset_type = 'player'
    where t.type = 'release' and t.status in ('proposed', 'approved')
      and t.season_id = v_season_id and ti.player_id = _player_id and ti.from_team_id = v_team
  ) then
    raise exception 'Esse jogador já tem uma dispensa pendente.';
  end if;

  -- Mínimo de 12 (s22): efeito desta dispensa + das já aprovadas na fila (mesmo time)
  select * into v_ef from public.dispensa_efeito(v_re);
  v_davail := v_ef.salary - v_ef.multa;
  for v_q in
    select ti.player_id
    from public.transactions t
    join public.transaction_items ti on ti.transaction_id = t.id and ti.asset_type = 'player'
    where t.type = 'release' and t.status = 'approved'
      and t.season_id = v_season_id and ti.from_team_id = v_team
  loop
    select re2.id into v_re2 from public.roster_entries re2
     where re2.team_id = v_team and re2.player_id = v_q.player_id
       and re2.season = v_season_int and re2.status = 'active';
    if v_re2 is not null then
      select * into v_ef from public.dispensa_efeito(v_re2);
      v_dslots := v_dslots - 1;
      v_davail := v_davail + v_ef.salary - v_ef.multa;
    end if;
  end loop;
  select count(*)::integer into v_n from public.roster_entries re
   where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';
  select c.available into v_av from public.team_cap_usage(v_season_id) c where c.team_id = v_team;
  if public.elenco_minimo_viola(v_n + v_dslots, coalesce(v_av, 0) + v_davail) then
    raise exception 'Dispensa bloqueada: %',
      public.elenco_minimo_msg('Seu time', v_n + v_dslots, coalesce(v_av, 0) + v_davail);
  end if;

  insert into public.transactions (type, status, season_id, week_number, proposed_by)
  values ('release', 'proposed', v_season_id, _week, v_gm)
  returning id into v_tx;

  insert into public.transaction_items (transaction_id, asset_type, player_id, from_team_id)
  values (v_tx, 'player', _player_id, v_team);

  -- sem aprovação do admin: entra aprovada. Mercado aberto = executa já; fechado = fila da consolidação.
  update public.transactions set status = 'approved', updated_at = now() where id = v_tx;

  select is_open into v_open from public.market_state where season_id = v_season_id;
  if coalesce(v_open, false) then
    perform public.executar_dispensa_core(v_tx);
  end if;

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Patches nas funções grandes
-- ---------------------------------------------------------------------
create or replace function pg_temp.patch_fn(_sig text, _anchor text, _repl text)
returns void language plpgsql as $f$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef(_sig::regprocedure);
  if position('elenco_minimo_viola' in v_def) > 0 then
    return;  -- já patcheada
  end if;
  v_new := replace(v_def, _anchor, _repl);
  if v_new = v_def then
    raise exception 'patch_fn: âncora não encontrada em %', _sig;
  end if;
  execute v_new;
end $f$;

-- 3a) executar_dispensa_core: revalida na execução (fila FIFO) — falha a dispensa se violar
select pg_temp.patch_fn(
  'public.executar_dispensa_core(uuid)',
  $a$    return 'Falhou: jogador não está mais no elenco ativo do time.';
  end if;
$a$,
  $b$    return 'Falhou: jogador não está mais no elenco ativo do time.';
  end if;

  -- Mínimo de 12 (s22): a dispensa não pode deixar o time sem cap para a contratação automática
  declare
    v_ef2 record; v_n2 integer; v_av2 bigint; v_nm2 text;
  begin
    select * into v_ef2 from public.dispensa_efeito(v_re_id);
    select count(*)::integer into v_n2 from public.roster_entries re
     where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';
    select c.available into v_av2 from public.team_cap_usage(v_tx.season_id) c where c.team_id = v_team;
    v_av2 := coalesce(v_av2, 0) + v_ef2.salary - v_ef2.multa;
    if public.elenco_minimo_viola(v_n2 - 1, v_av2) then
      select name into v_nm2 from public.teams where id = v_team;
      update public.transactions
         set status = 'failed', updated_at = now(),
             notes  = coalesce(notes || ' | ', '') || 'dispensa bloqueada: elenco mínimo de 12'
       where id = _tx_id;
      return 'Falhou: ' || public.elenco_minimo_msg(v_nm2, v_n2 - 1, v_av2);
    end if;
  end;
$b$);

-- 3b) propor_troca: bloqueio na proposta
select pg_temp.patch_fn(
  'public.propor_troca(jsonb,integer,timestamp with time zone)',
  $a$    if v_proj.new_slots > 15 then$a$,
  $b$    if public.elenco_minimo_viola(v_proj.new_slots, 70000000 - v_proj.new_used) then
      raise exception '%', public.elenco_minimo_msg(v_name, v_proj.new_slots, 70000000 - v_proj.new_used);
    end if;
    if v_proj.new_slots > 15 then$b$);

-- 3c) executar_troca: revalida no commit (cai no handler -> troca 'failed'); override do admin libera
select pg_temp.patch_fn(
  'public.executar_troca(uuid)',
  $a$        raise exception '% estourou o teto (cap disponível %).', v_name, v_bad.available;
      end loop;
$a$,
  $b$        raise exception '% estourou o teto (cap disponível %).', v_name, v_bad.available;
      end loop;

      for v_bad in
        select c.team_id, c.available,
               (select count(*) from public.roster_entries re
                 where re.team_id = c.team_id and re.season = v_season_int
                   and re.status <> 'injured_reserve')::integer as n
        from public.team_cap_usage(v_tx.season_id) c
        where c.team_id = any(v_parties)
      loop
        if public.elenco_minimo_viola(v_bad.n, v_bad.available) then
          select name into v_name from public.teams where id = v_bad.team_id;
          raise exception '%', public.elenco_minimo_msg(v_name, v_bad.n, v_bad.available);
        end if;
      end loop;
$b$);

-- 3d) simular_troca: mesmo erro na simulação da tela
select pg_temp.patch_fn(
  'public.simular_troca(jsonb)',
  $a$      v_errs := v_errs || format('%s ficaria com %s jogadores ativos (máx %s).', r.name, r.slots_after, c_slots);
    end if;
$a$,
  $b$      v_errs := v_errs || format('%s ficaria com %s jogadores ativos (máx %s).', r.name, r.slots_after, c_slots);
    end if;
    if public.elenco_minimo_viola(r.slots_after, c_cap - r.cap_after) then
      v_errs := v_errs || public.elenco_minimo_msg(r.name, r.slots_after, c_cap - r.cap_after);
    end if;
$b$);

-- 3e) executar_ir: revalida na execução
select pg_temp.patch_fn(
  'public.executar_ir(uuid,text)',
  $a$    return 'Falhou: jogador não está mais ativo no elenco do time.';
  end if;
$a$,
  $b$    return 'Falhou: jogador não está mais ativo no elenco do time.';
  end if;

  -- Mínimo de 12 (s22): IR tira 1 ativo; fora da temporada libera 80% do salário no cap
  declare
    v_n2 integer; v_av2 bigint; v_sal2 bigint; v_nm2 text;
  begin
    select count(*)::integer into v_n2 from public.roster_entries re
     where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';
    select c.available into v_av2 from public.team_cap_usage(v_tx.season_id) c where c.team_id = v_team;
    select cy.salary into v_sal2 from public.roster_contract_years cy
      join public.seasons s on s.label = cy.season_label and s.id = v_tx.season_id
     where cy.roster_entry_id = v_re;
    v_av2 := coalesce(v_av2, 0) + case when v_type = 'out_of_season' then round(coalesce(v_sal2, 0) * 0.8)::bigint else 0 end;
    if public.elenco_minimo_viola(v_n2 - 1, v_av2) then
      select name into v_nm2 from public.teams where id = v_team;
      update public.transactions
         set status = 'failed', updated_at = now(),
             notes  = coalesce(notes || ' | ', '') || 'IR bloqueado: elenco mínimo de 12'
       where id = _tx_id;
      return 'Falhou: ' || public.elenco_minimo_msg(v_nm2, v_n2 - 1, v_av2);
    end if;
  end;
$b$);

-- ---------------------------------------------------------------------
-- 4) solicitar_ir: bloqueio na solicitação
-- ---------------------------------------------------------------------
create or replace function public.solicitar_ir(_player_id uuid, _week integer default null, _ir_type text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_gm         uuid := public.current_gm_id();
  v_team       uuid := public.current_team_id();
  v_season_id  uuid;
  v_season_int integer;
  v_tx         uuid;
  v_re         uuid;
  v_n          integer;
  v_av         bigint;
  v_sal        bigint;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  if _ir_type is null or _ir_type not in ('partial', 'out_of_season') then
    raise exception 'Informe o tipo de IR: parcial (partial) ou fora da temporada (out_of_season).';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  select re.id into v_re from public.roster_entries re
  where re.team_id = v_team and re.player_id = _player_id
    and re.season = v_season_int and re.status = 'active';
  if v_re is null then
    raise exception 'Jogador não está ativo no elenco do seu time.';
  end if;

  -- Mínimo de 12 (s22)
  select count(*)::integer into v_n from public.roster_entries re
   where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';
  select c.available into v_av from public.team_cap_usage(v_season_id) c where c.team_id = v_team;
  select cy.salary into v_sal from public.roster_contract_years cy
    join public.seasons s on s.label = cy.season_label and s.id = v_season_id
   where cy.roster_entry_id = v_re;
  v_av := coalesce(v_av, 0) + case when _ir_type = 'out_of_season' then round(coalesce(v_sal, 0) * 0.8)::bigint else 0 end;
  if public.elenco_minimo_viola(v_n - 1, v_av) then
    raise exception 'IR bloqueado: %', public.elenco_minimo_msg('Seu time', v_n - 1, v_av);
  end if;

  insert into public.transactions (type, status, season_id, week_number, proposed_by, ir_type)
  values ('ir', 'proposed', v_season_id, _week, v_gm, _ir_type)
  returning id into v_tx;

  insert into public.transaction_items (transaction_id, asset_type, player_id, from_team_id)
  values (v_tx, 'player', _player_id, v_team);

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Contratação automática do mínimo de 12
-- ---------------------------------------------------------------------
create or replace function public.consolidar_minimo_elencos(_season_id uuid, _week integer)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  c_min constant integer := 12;
  c_sal constant bigint  := 750000;
  v_start  integer;
  v_label  text;
  v_team   record;
  v_cand   record;
  v_tx     uuid;
  v_re     uuid;
  v_signed jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_skip   uuid[] := '{}';
  v_iter   integer := 0;
  v_sempos text;
begin
  select start_year, label into v_start, v_label from public.seasons where id = _season_id;

  loop
    v_iter := v_iter + 1;
    exit when v_iter > 200;

    -- próximo time: menos ativos -> pior aproveitamento (V/J) -> nome
    select t.id as id, t.name as name, n.ativos as ativos, coalesce(c.available, 0) as avail
      into v_team
      from public.teams t
      cross join lateral (
        select count(*)::integer as ativos from public.roster_entries re
         where re.team_id = t.id and re.season = v_start and re.status <> 'injured_reserve'
      ) n
      left join public.team_cap_usage(_season_id) c on c.team_id = t.id
      left join public.get_standings(array[_season_id]) s on s.team_id = t.id
     where t.is_active and n.ativos < c_min and not (t.id = any(v_skip))
     order by n.ativos asc, coalesce(s.w::numeric / nullif(s.gp, 0), 0) asc, t.name asc
     limit 1;
    exit when v_team.id is null;

    if v_team.avail < c_sal then
      v_alerts := v_alerts || to_jsonb(format('%s tem %s ativo(s) e cap livre de $%s (< $750,000): sem contratação automática.',
                                              v_team.name, v_team.ativos, to_char(v_team.avail, 'FM999,999,999,999')));
      v_skip := v_skip || v_team.id;
      continue;
    end if;

    -- candidato: dispensado mais recente, fora de elenco, que o time não dispensou, com posição conhecida
    select p.id as id, p.full_name as name, x.pos as pos
      into v_cand
      from (
        select distinct on (ti.player_id) ti.player_id, tr.created_at as rel_at
          from public.transactions tr
          join public.transaction_items ti on ti.transaction_id = tr.id and ti.asset_type = 'player'
         where tr.type = 'release' and tr.status = 'executed' and tr.season_id = _season_id
         order by ti.player_id, tr.created_at desc
      ) rel
      join public.players p on p.id = rel.player_id and not coalesce(p.is_pending, false)
      cross join lateral (select public.posicao_conhecida(p.id) as pos) x
     where x.pos is not null
       and not exists (select 1 from public.roster_entries r where r.player_id = p.id and r.season = v_start)
       and not exists (
         select 1 from public.transactions t2
           join public.transaction_items i2 on i2.transaction_id = t2.id and i2.asset_type = 'player'
          where t2.type = 'release' and t2.status = 'executed' and t2.season_id = _season_id
            and i2.player_id = p.id and i2.from_team_id = v_team.id)
     order by rel.rel_at desc
     limit 1;

    if v_cand.id is null then
      select string_agg(p.full_name, ', ') into v_sempos
        from (select distinct ti.player_id
                from public.transactions tr
                join public.transaction_items ti on ti.transaction_id = tr.id and ti.asset_type = 'player'
               where tr.type = 'release' and tr.status = 'executed' and tr.season_id = _season_id) d
        join public.players p on p.id = d.player_id
       where public.posicao_conhecida(p.id) is null
         and not exists (select 1 from public.roster_entries r where r.player_id = p.id and r.season = v_start);
      v_alerts := v_alerts || to_jsonb(format('%s tem %s ativo(s) e não há dispensado elegível para a contratação automática%s.',
                                              v_team.name, v_team.ativos,
                                              case when v_sempos is not null then ' (sem posição conhecida: ' || v_sempos || ')' else '' end));
      v_skip := v_skip || v_team.id;
      continue;
    end if;

    insert into public.transactions (type, status, season_id, week_number, proposed_by, executed_at, notes)
    values ('signing', 'executed', _season_id, _week, null, now(), 'Contratação automática (mínimo de 12 jogadores)')
    returning id into v_tx;

    insert into public.roster_entries (team_id, player_id, season, status, position, acquired_via)
    values (v_team.id, v_cand.id, v_start, 'active', v_cand.pos, 'signing')
    returning id into v_re;

    insert into public.roster_contract_years (roster_entry_id, season_label, salary)
    values (v_re, v_label, c_sal);

    insert into public.transaction_items (transaction_id, asset_type, player_id, to_team_id, amount)
    values (v_tx, 'player', v_cand.id, v_team.id, c_sal);

    v_signed := v_signed || jsonb_build_object('team', v_team.name, 'player', v_cand.name, 'pos', v_cand.pos);
  end loop;

  return jsonb_build_object('signed', v_signed, 'alerts', v_alerts);
end;
$$;

-- ---------------------------------------------------------------------
-- 6) leilao_commit = leilao_aplicar (corpo antigo) + mínimo de 12
--    (vale para "Consolidar" e para "Processar só o leilão")
-- ---------------------------------------------------------------------
do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.leilao_commit(uuid,integer)'::regprocedure);
  if position('consolidar_minimo_elencos' in v_def) = 0 then
    execute replace(v_def, 'FUNCTION public.leilao_commit(', 'FUNCTION public.leilao_aplicar(');
  end if;
end $mig$;

create or replace function public.leilao_commit(_season_id uuid, _week integer)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_res text;
  v_min jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin consolida o leilão.';
  end if;

  v_res := public.leilao_aplicar(_season_id, _week);
  v_min := public.consolidar_minimo_elencos(_season_id, _week);

  v_res := v_res || format(' Mínimo de 12: %s contratação(ões) automática(s).', jsonb_array_length(v_min->'signed'));
  if jsonb_array_length(v_min->'alerts') > 0 then
    v_res := v_res || ' ALERTAS: ' || (select string_agg(a, ' | ') from jsonb_array_elements_text(v_min->'alerts') a) || '.';
  end if;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Prévia da consolidação: simula fila + leilão + mínimo de 12 e DESFAZ (subtransação)
-- ---------------------------------------------------------------------
create or replace function public.minimo_previa(_week integer)
returns table(ord integer, detalhe text)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_season uuid;
  v_tx     record;
  v_r      text;
  v_min    jsonb;
  v_falhas jsonb := '[]'::jsonb;
  v_err    text;
  v_i      integer := 0;
  v_e      jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin vê a prévia do mínimo de 12.';
  end if;
  select id into v_season from public.seasons where is_current = true;

  begin
    for v_tx in
      select id, type from public.transactions
       where season_id = v_season and status = 'approved' and type in ('release', 'trade')
       order by created_at, id
    loop
      if v_tx.type = 'release' then
        v_r := public.executar_dispensa_core(v_tx.id);
      else
        v_r := public.executar_troca(v_tx.id);
      end if;
      if v_r like 'Falhou%' then
        v_falhas := v_falhas || to_jsonb(format('Fila: tx #%s falharia — %s', left(v_tx.id::text, 8), v_r));
      end if;
    end loop;
    perform public.leilao_aplicar(v_season, _week);
    v_min := public.consolidar_minimo_elencos(v_season, _week);
    raise exception 'previa' using errcode = 'PV001';
  exception
    when sqlstate 'PV001' then
      null;
    when others then
      v_err := SQLERRM;
  end;

  if v_err is not null then
    v_i := v_i + 1; ord := v_i; detalhe := 'Prévia do mínimo de 12 indisponível: ' || v_err;
    return next; return;
  end if;

  for v_e in select * from jsonb_array_elements(v_falhas) loop
    v_i := v_i + 1; ord := v_i; detalhe := 'ALERTA: ' || (v_e #>> '{}'); return next;
  end loop;
  for v_e in select * from jsonb_array_elements(v_min->'signed') loop
    v_i := v_i + 1; ord := v_i;
    detalhe := format('%s <- %s (%s) · $750,000 · 1 ano', v_e->>'team', v_e->>'player', v_e->>'pos');
    return next;
  end loop;
  for v_e in select * from jsonb_array_elements(v_min->'alerts') loop
    v_i := v_i + 1; ord := v_i; detalhe := 'ALERTA: ' || (v_e #>> '{}'); return next;
  end loop;
  if v_i = 0 then
    ord := 1; detalhe := 'Nenhum time fica abaixo de 12 ativos após o leilão.'; return next;
  end if;
end;
$$;

create or replace function public.consolidar_mercado_previa(_week integer)
returns table(fase text, detalhe text)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_season uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin vê a prévia da consolidação.';
  end if;
  select id into v_season from public.seasons where is_current = true;

  return query
    select x.fase, x.detalhe
    from (
      -- Fase 1: fila de dispensas/trocas aprovadas (FIFO)
      select 0 as g, extract(epoch from t.created_at)::float8 as ord,
             'Fase 1 - fila'::text as fase,
             format('%s | tx %s | criada %s', t.type, t.id, t.created_at) as detalhe
      from public.transactions t
      where t.season_id = v_season and t.status = 'approved' and t.type in ('release','trade')
      union all
      -- Fase 2: vencedores projetados do leilão
      select 1 as g, (-r.salary_offer)::float8, 'Fase 2 - leilão'::text,
             format('%s -> %s (%s)', p.full_name || case when p.is_pending then ' [NOVO · ' || coalesce(p.pending_position, 'SEM POSIÇÃO') || ']' else '' end, tm.name, r.salary_offer)
      from public.leilao_resolver(v_season, _week) r
      join public.players p on p.id = r.player_id
      join public.teams   tm on tm.id = r.team_id
      union all
      -- Fase 3 (s22): contratações automáticas do mínimo de 12 (simulação desfeita)
      select 2 as g, m.ord::float8, 'Fase 3 - mínimo de 12'::text, m.detalhe
      from public.minimo_previa(_week) m
    ) x
    order by x.g, x.ord;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Avisos/e-mail: rotular a contratação automática
-- ---------------------------------------------------------------------
create or replace function public.trg_notify_signing_item()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_type text; v_season uuid; v_cur boolean; v_player text; v_team text; v_notes text; v_auto boolean;
begin
  begin
    if new.asset_type <> 'player' or new.to_team_id is null then return new; end if;
    select type, season_id, notes into v_type, v_season, v_notes from public.transactions where id = new.transaction_id;
    if v_type is distinct from 'signing' then return new; end if;
    select is_current into v_cur from public.seasons where id = v_season;
    if not coalesce(v_cur, false) then return new; end if;
    v_auto := coalesce(v_notes, '') like 'Contratação automática%';
    select full_name into v_player from public.players where id = new.player_id;
    select name into v_team from public.teams where id = new.to_team_id;
    perform public.notify_gms(null, 'leilao', 'signing',
      case when v_auto then 'Contratação automática' else 'Contratação no leilão' end,
      coalesce(v_team, 'Um time') || ' contratou ' || coalesce(v_player, 'um jogador') ||
      ' por $' || to_char(coalesce(new.amount, 0), 'FM999,999,999') ||
      case when v_auto then ' (mínimo de 12 jogadores).' else '.' end,
      '/movimentacoes', 'mov:' || new.transaction_id);
  exception when others then
    null;
  end;
  return new;
end $$;

create or replace function public.trg_email_signing_item()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_type text; v_season uuid; v_exec timestamptz; v_cur boolean; v_start int;
        v_player text; v_team text; v_pos text; v_notes text; v_auto boolean;
begin
  begin
    if new.asset_type <> 'player' or new.to_team_id is null then return new; end if;
    select type, season_id, executed_at, notes into v_type, v_season, v_exec, v_notes from public.transactions where id = new.transaction_id;
    if v_type is distinct from 'signing' then return new; end if;
    select is_current, start_year into v_cur, v_start from public.seasons where id = v_season;
    if not coalesce(v_cur, false) then return new; end if;
    v_auto := coalesce(v_notes, '') like 'Contratação automática%';
    select full_name into v_player from public.players where id = new.player_id;
    select name into v_team from public.teams where id = new.to_team_id;
    select position into v_pos from public.roster_entries
     where player_id = new.player_id and team_id = new.to_team_id and season = v_start limit 1;
    perform public.email_enqueue('signing', coalesce(v_exec, now()), 'sig:' || new.id,
      jsonb_build_object('team', v_team, 'player', v_player, 'pos', v_pos, 'salary', new.amount, 'auto', v_auto));
  exception when others then
    null;
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 9) Permissões: internas sem grant; prévia só autenticado (checa admin dentro)
-- ---------------------------------------------------------------------
revoke all on function public.consolidar_minimo_elencos(uuid, integer) from public, anon, authenticated;
revoke all on function public.leilao_aplicar(uuid, integer)           from public, anon, authenticated;
revoke all on function public.dispensa_efeito(uuid)                   from public, anon, authenticated;
revoke all on function public.minimo_previa(integer)                  from public, anon;
grant execute on function public.minimo_previa(integer) to authenticated;
grant execute on function public.posicao_conhecida(uuid)              to authenticated;
grant execute on function public.elenco_minimo_viola(integer, bigint) to authenticated;
grant execute on function public.elenco_minimo_msg(text, integer, bigint) to authenticated;
