-- 20261105_simular_troca.sql
--
-- Simulador da tela /trocar: devolve, SEM gravar nada, a projeção de cap e vagas dos times
-- envolvidos e a lista de motivos pelos quais a proposta seria recusada pelo propor_troca.
-- Mesmas regras do servidor: jogador ativo, pick livre e do time de origem, multa do time de
-- origem (mínimo 50.000 por ano/destino, soma das fatias <= saldo), Regra 1 (1ª própria),
-- cap <= 70M (só salário e multa da temporada corrente) e no máximo 15 vagas (fora do IR).
--
-- Entrada: mesmo jsonb do propor_troca (asset_type, player_id, pick_id, source_penalty_id,
--          from_team_id, to_team_id, amount).
-- Saída:   { valid, errors[], cap_limit, slot_limit,
--            teams: [{team_id, name, cap_before, cap_after, slots_before, slots_after}] }
--
-- Aditiva: não altera nenhuma função existente. Somente usuários autenticados.
-- Reversão: drop function public.simular_troca(jsonb);

create or replace function public.simular_troca(_itens jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_season uuid; v_label text; v_start int;
  v_errs   text[] := array[]::text[];
  v_teams  jsonb;
  r        record;
  c_cap    constant bigint := 70000000;
  c_slots  constant int := 15;
begin
  select id, label, start_year into v_season, v_label, v_start
  from public.seasons where is_current = true;

  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    return jsonb_build_object('valid', false, 'errors', '[]'::jsonb, 'teams', '[]'::jsonb,
                              'cap_limit', c_cap, 'slot_limit', c_slots);
  end if;

  -- jogadores: precisam estar ativos no time de origem
  for r in
    select pl.full_name pname, tm.name tname
    from jsonb_to_recordset(_itens) as x(asset_type text, player_id uuid, from_team_id uuid)
    join public.players pl on pl.id = x.player_id
    join public.teams tm on tm.id = x.from_team_id
    where x.asset_type = 'player'
      and not exists (
        select 1 from public.roster_entries re
        where re.team_id = x.from_team_id and re.player_id = x.player_id
          and re.season = v_start and re.status = 'active')
  loop
    v_errs := v_errs || format('%s não está ativo no elenco do %s (IR/ausente não troca).', r.pname, r.tname);
  end loop;

  -- picks: do time de origem, não usadas, sem disputa
  for r in
    select dp.round, coalesce(ds.label, '—') lbl, tm.name tname,
           (dp.current_team_id is distinct from x.from_team_id) wrong_owner, dp.is_used, dp.disputed
    from jsonb_to_recordset(_itens) as x(asset_type text, pick_id uuid, from_team_id uuid)
    join public.draft_picks dp on dp.id = x.pick_id
    left join public.seasons ds on ds.id = dp.draft_season_id
    join public.teams tm on tm.id = x.from_team_id
    where x.asset_type = 'pick'
  loop
    if r.wrong_owner then
      v_errs := v_errs || format('A %sª de %s não pertence ao %s.', r.round, r.lbl, r.tname);
    elsif r.is_used then
      v_errs := v_errs || format('A %sª de %s já foi usada.', r.round, r.lbl);
    elsif r.disputed then
      v_errs := v_errs || format('A %sª de %s está em disputa — o admin resolve antes de negociar.', r.round, r.lbl);
    end if;
  end loop;

  -- multas: do time de origem e com valor válido
  for r in
    select coalesce(s.label, '—') lbl, tm.name tname,
           (tp.team_id is distinct from x.from_team_id) wrong_owner,
           (x.amount is null or x.amount <= 0) bad_amount
    from jsonb_to_recordset(_itens) as x(asset_type text, source_penalty_id uuid, from_team_id uuid, amount bigint)
    join public.team_penalties tp on tp.id = x.source_penalty_id
    left join public.seasons s on s.id = tp.season_id
    join public.teams tm on tm.id = x.from_team_id
    where x.asset_type = 'penalty'
  loop
    if r.wrong_owner then
      v_errs := v_errs || format('A multa %s não pertence ao %s.', r.lbl, r.tname);
    elsif r.bad_amount then
      v_errs := v_errs || format('Valor inválido na multa %s.', r.lbl);
    end if;
  end loop;

  -- multa mínima por ano (somando as fatias do mesmo ano, origem e destino)
  for r in
    select coalesce(s.label, '—') lbl, sum(x.amount) tot
    from jsonb_to_recordset(_itens) as x(asset_type text, source_penalty_id uuid, from_team_id uuid, to_team_id uuid, amount bigint)
    join public.team_penalties tp on tp.id = x.source_penalty_id
    left join public.seasons s on s.id = tp.season_id
    where x.asset_type = 'penalty' and x.amount > 0
    group by x.from_team_id, x.to_team_id, tp.season_id, s.label
    having sum(x.amount) < 50000
  loop
    v_errs := v_errs || format('Multa %s: o mínimo por ano é $50,000 (enviado: $%s).',
                               r.lbl, to_char(r.tot, 'FM999,999,999'));
  end loop;

  -- soma das fatias não pode passar do saldo da multa
  for r in
    select coalesce(s.label, '—') lbl, tp.amount saldo, sum(x.amount) req
    from jsonb_to_recordset(_itens) as x(asset_type text, source_penalty_id uuid, amount bigint)
    join public.team_penalties tp on tp.id = x.source_penalty_id
    left join public.seasons s on s.id = tp.season_id
    where x.asset_type = 'penalty'
    group by tp.id, s.label, tp.amount
    having sum(x.amount) > tp.amount
  loop
    v_errs := v_errs || format('Multa %s: valor acima do saldo ($%s de $%s).',
                               r.lbl, to_char(r.req, 'FM999,999,999'), to_char(r.saldo, 'FM999,999,999'));
  end loop;

  -- Regra 1 (1ª própria nunca 2 anos seguidos), simulando o estado pós-troca
  begin
    perform public.validar_picks_proprias_troca(_itens);
  exception when others then
    v_errs := v_errs || SQLERRM;
  end;

  -- projeção de cap e vagas por time (igual à troca_projecao, mas a partir dos itens)
  with it as (
    select * from jsonb_to_recordset(_itens)
      as x(asset_type text, player_id uuid, source_penalty_id uuid, from_team_id uuid, to_team_id uuid, amount bigint)
  ),
  parties as (
    select from_team_id t from it where from_team_id is not null
    union
    select to_team_id from it where to_team_id is not null
  ),
  psal as (
    select i.from_team_id, i.to_team_id,
           coalesce((
             select sum(cy.salary) from public.roster_entries re
             join public.roster_contract_years cy
               on cy.roster_entry_id = re.id and cy.season_label = v_label
             where re.player_id = i.player_id and re.team_id = i.from_team_id
               and re.season = v_start and re.status = 'active'), 0)::bigint sal
    from it i where i.asset_type = 'player'
  ),
  pen as (
    select i.from_team_id, i.to_team_id, i.amount
    from it i join public.team_penalties tp on tp.id = i.source_penalty_id
    where i.asset_type = 'penalty' and tp.season_id = v_season
  ),
  delta as (
    select from_team_id t, -sal dcap, -1 dslot from psal
    union all select to_team_id, sal, 1 from psal
    union all select from_team_id, -amount, 0 from pen
    union all select to_team_id, amount, 0 from pen
  ),
  agg as (
    select t, coalesce(sum(dcap), 0)::bigint dcap, coalesce(sum(dslot), 0)::int dslot
    from delta group by t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id', p.t,
           'name', tm.name,
           'cap_before', c.used,
           'cap_after', c.used + coalesce(a.dcap, 0),
           'slots_before', sl.n,
           'slots_after', sl.n + coalesce(a.dslot, 0)
         ) order by tm.name), '[]'::jsonb)
    into v_teams
  from parties p
  join public.teams tm on tm.id = p.t
  join public.team_cap_usage(v_season) c on c.team_id = p.t
  cross join lateral (
    select count(*)::int n from public.roster_entries re
    where re.team_id = p.t and re.season = v_start and re.status <> 'injured_reserve'
  ) sl
  left join agg a on a.t = p.t;

  for r in
    select * from jsonb_to_recordset(v_teams)
      as t(team_id uuid, name text, cap_before bigint, cap_after bigint, slots_before int, slots_after int)
  loop
    if r.cap_after > c_cap then
      v_errs := v_errs || format('%s ficaria com cap de $%s (teto $%s).', r.name,
                                 to_char(r.cap_after, 'FM999,999,999'), to_char(c_cap, 'FM999,999,999'));
    end if;
    if r.slots_after > c_slots then
      v_errs := v_errs || format('%s ficaria com %s jogadores ativos (máx %s).', r.name, r.slots_after, c_slots);
    end if;
  end loop;

  return jsonb_build_object(
    'valid', cardinality(v_errs) = 0,
    'errors', to_jsonb(v_errs),
    'teams', v_teams,
    'cap_limit', c_cap,
    'slot_limit', c_slots
  );
end;
$function$;

revoke all on function public.simular_troca(jsonb) from public, anon;
grant execute on function public.simular_troca(jsonb) to authenticated;
