-- 20261024_ir_tipos.sql
--
-- Dois tipos de IR:
--
--   partial        (IR parcial)  — jogador parado por 3+ semanas. Libera a vaga no elenco;
--                                  o salário CONTINUA contando 100% no cap. Para voltar,
--                                  o time precisa ter vaga (se estiver com 15, tem que
--                                  dispensar/trocar alguém antes). Pode voltar a qualquer momento.
--   out_of_season  (fora da temporada) — jogador que não atua mais na temporada. Libera a vaga
--                                  e só 20% do salário da temporada atual conta no cap
--                                  (restante do contrato inalterado). Retorno só na temporada
--                                  seguinte (como já era).
--
-- Antes: todo IR liberava vaga E tirava 100% do salário do cap (equivalente a um out_of_season a 0%).
-- O admin continua decidindo se a solicitação é válida (decidir_transacao) e pode ajustar o tipo
-- ao executar (executar_ir recebe _ir_type opcional).
--
-- Backfill dos 8 jogadores já em IR (informado pelo dono da liga):
--   out_of_season: Henri Veesaar, Otega Oweh   |   partial: os outros 6.
--
-- PENDENTE (confirmar com o admin): fluxo de reativação do IR parcial (hoje só admin reativa,
-- via reativar_ir; o parcial pode voltar a qualquer momento se houver vaga).
--
-- Reversão (resumo): recriar team_cap_usage/solicitar_ir/executar_ir/reativar_ir/get_movimentacoes_pagina
-- a partir de 20261007_fix_team_cap_usage_season_label.sql e dos dumps anteriores;
-- depois drop das colunas ir_type (roster_entries, transactions).

-- ─── 1. Colunas e constraints ────────────────────────────────────────────────

alter table public.roster_entries add column if not exists ir_type text;
alter table public.transactions   add column if not exists ir_type text;

alter table public.roster_entries
  add constraint roster_entries_ir_type_check
  check (ir_type is null or ir_type in ('partial', 'out_of_season'));

alter table public.transactions
  add constraint transactions_ir_type_check
  check (ir_type is null or ir_type in ('partial', 'out_of_season'));

-- ─── 2. Backfill dos jogadores em IR hoje ────────────────────────────────────

update public.roster_entries re
   set ir_type = case when pl.full_name in ('Henri Veesaar', 'Otega Oweh')
                      then 'out_of_season' else 'partial' end,
       updated_at = now()
  from public.players pl
 where pl.id = re.player_id
   and re.status = 'injured_reserve'
   and re.ir_type is null;

-- Todo IR precisa ter tipo (depois do backfill).
alter table public.roster_entries
  add constraint roster_entries_ir_requires_type
  check (status <> 'injured_reserve' or ir_type is not null);

-- ─── 3. Cap: parcial 100%, fora da temporada 20% ─────────────────────────────

create or replace function public.team_cap_usage(_season_id uuid)
returns table(team_id uuid, salaries bigint, penalties bigint, used bigint, available bigint)
language sql stable as $function$
  with s as (
    select start_year as yr, label as season_label
    from seasons
    where id = _season_id
  ),
  sal as (
    select re.team_id,
           coalesce(sum(
             case when re.status = 'injured_reserve' and re.ir_type = 'out_of_season'
                  then round(cy.salary * 0.2)
                  else cy.salary
             end
           ), 0)::bigint as salaries
    from roster_entries re
    join roster_contract_years cy
      on cy.roster_entry_id = re.id
     and cy.season_label = (select season_label from s)   -- usa seasons.label ('26/27')
    where re.season = (select yr from s)
    group by re.team_id
  ),
  pen as (
    select tp.team_id, coalesce(sum(tp.amount),0)::bigint as penalties
    from team_penalties tp
    where tp.season_id = _season_id
    group by tp.team_id
  )
  select t.id,
         coalesce(sal.salaries,0)::bigint,
         coalesce(pen.penalties,0)::bigint,
         (coalesce(sal.salaries,0) + coalesce(pen.penalties,0))::bigint,
         (70000000 - coalesce(sal.salaries,0) - coalesce(pen.penalties,0))::bigint
  from teams t
  left join sal on sal.team_id = t.id
  left join pen on pen.team_id = t.id
  where t.is_active;
$function$;

-- ─── 4. Solicitar IR (agora com tipo) ────────────────────────────────────────

drop function if exists public.solicitar_ir(uuid, integer);

create or replace function public.solicitar_ir(
  _player_id uuid,
  _week integer default null,
  _ir_type text default null
)
returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_gm         uuid := public.current_gm_id();
  v_team       uuid := public.current_team_id();
  v_season_id  uuid;
  v_season_int integer;
  v_tx         uuid;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  if _ir_type is null or _ir_type not in ('partial', 'out_of_season') then
    raise exception 'Informe o tipo de IR: parcial (partial) ou fora da temporada (out_of_season).';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  if not exists (
    select 1 from public.roster_entries re
    where re.team_id = v_team and re.player_id = _player_id
      and re.season = v_season_int and re.status = 'active'
  ) then
    raise exception 'Jogador não está ativo no elenco do seu time.';
  end if;

  insert into public.transactions (type, status, season_id, week_number, proposed_by, ir_type)
  values ('ir', 'proposed', v_season_id, _week, v_gm, _ir_type)
  returning id into v_tx;

  insert into public.transaction_items (transaction_id, asset_type, player_id, from_team_id)
  values (v_tx, 'player', _player_id, v_team);

  return v_tx;
end;
$function$;

-- ─── 5. Executar IR (tipo vem da solicitação; admin pode ajustar) ─────────────

drop function if exists public.executar_ir(uuid);

create or replace function public.executar_ir(_tx_id uuid, _ir_type text default null)
returns text
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tx         record;
  v_player     uuid;
  v_team       uuid;
  v_season_int integer;
  v_re         uuid;
  v_type       text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin executa.';
  end if;

  if _ir_type is not null and _ir_type not in ('partial', 'out_of_season') then
    raise exception 'Tipo de IR inválido: %.', _ir_type;
  end if;

  select * into v_tx from public.transactions where id = _tx_id;
  if v_tx is null then raise exception 'Transação não encontrada.'; end if;
  if v_tx.type <> 'ir' then raise exception 'Transação não é IR (type=%).', v_tx.type; end if;
  if v_tx.status <> 'approved' then raise exception 'Transação não está aprovada (status=%).', v_tx.status; end if;

  v_type := coalesce(_ir_type, v_tx.ir_type);
  if v_type is null then
    raise exception 'Tipo de IR não informado na solicitação; escolha o tipo ao executar.';
  end if;

  select ti.player_id, ti.from_team_id into v_player, v_team
  from public.transaction_items ti
  where ti.transaction_id = _tx_id and ti.asset_type = 'player'
  limit 1;

  select start_year into v_season_int from public.seasons where id = v_tx.season_id;

  -- revalida: jogador ainda ativo no elenco do time (o mundo pode ter mudado)
  select re.id into v_re
  from public.roster_entries re
  where re.team_id = v_team and re.player_id = v_player
    and re.season = v_season_int and re.status = 'active';

  if v_re is null then
    update public.transactions
       set status = 'failed', updated_at = now(),
           notes  = coalesce(notes || ' | ', '') || 'jogador não está mais ativo no elenco'
     where id = _tx_id;
    return 'Falhou: jogador não está mais ativo no elenco do time.';
  end if;

  update public.roster_entries
     set status = 'injured_reserve', ir_type = v_type,
         ir_since_season = v_season_int, updated_at = now()
   where id = v_re;

  update public.transactions
     set status = 'executed', ir_type = v_type,
         executed_at = now(), updated_at = now()
   where id = _tx_id;

  return case v_type
    when 'partial'
      then 'IR parcial aplicado: libera a vaga; o salário segue contando 100% no cap.'
    else 'IR fora da temporada aplicado: libera a vaga; só 20% do salário da temporada atual conta no cap; retorno só na próxima temporada.'
  end;
end;
$function$;

-- ─── 6. Reativar IR (regras por tipo) ────────────────────────────────────────

create or replace function public.reativar_ir(_player_id uuid, _override boolean default false)
returns text
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_season_id  uuid;
  v_season_int integer;
  v_label      text;
  v_re_id      uuid;
  v_team       uuid;
  v_ir_season  integer;
  v_ir_type    text;
  v_sal        bigint;
  v_delta      bigint;
  v_ativos     integer;
  v_avail      bigint;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin reativa jogadores do IR.';
  end if;

  select id, start_year, label into v_season_id, v_season_int, v_label
  from public.seasons where is_current = true;

  select re.id, re.team_id, re.ir_since_season, coalesce(re.ir_type, 'partial')
    into v_re_id, v_team, v_ir_season, v_ir_type
  from public.roster_entries re
  where re.player_id = _player_id and re.season = v_season_int and re.status = 'injured_reserve';

  if not found then
    raise exception 'Jogador não está no IR na temporada corrente.';
  end if;

  -- fora da temporada: retorno só na temporada seguinte. Parcial: a qualquer momento.
  if v_ir_type = 'out_of_season' and v_ir_season is not null and v_season_int <= v_ir_season then
    raise exception 'IR fora da temporada: retorno só na temporada seguinte (IR desde a temporada %).', v_ir_season;
  end if;

  if not _override then
    select count(*) into v_ativos
    from public.roster_entries re
    where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';

    -- vale para os dois tipos: o retornante volta a ocupar 1 vaga
    if v_ativos + 1 > 15 then
      raise exception 'Sem vaga: o time já tem % jogadores ativos. Dispense ou troque alguém antes de reativar.', v_ativos;
    end if;

    -- cap: só o out_of_season muda (de 20% para 100%); no parcial o salário já contava inteiro
    if v_ir_type = 'out_of_season' then
      select coalesce(sum(cy.salary), 0)::bigint into v_sal
      from public.roster_contract_years cy
      where cy.roster_entry_id = v_re_id and cy.season_label = v_label;

      v_delta := v_sal - round(v_sal * 0.2)::bigint;

      select available into v_avail from public.team_cap_usage(v_season_id) where team_id = v_team;

      if coalesce(v_avail, 0) - v_delta < 0 then
        raise exception 'Reativar estoura o cap (disponível %, acréscimo de salário %).', coalesce(v_avail, 0), v_delta;
      end if;
    end if;
  end if;

  update public.roster_entries
     set status = 'active', ir_since_season = null, ir_type = null, updated_at = now()
   where id = v_re_id;

  return case v_ir_type
    when 'partial' then 'Jogador reativado do IR parcial (volta a ocupar vaga; cap inalterado).'
    else 'Jogador reativado do IR fora da temporada (volta a contar vaga e 100% do salário).'
  end;
end;
$function$;

-- ─── 7. Feed de movimentações: devolve o tipo do IR ──────────────────────────

drop function if exists public.get_movimentacoes_pagina(uuid, text, uuid, int, int);

create or replace function public.get_movimentacoes_pagina(
  _season_id uuid default null,
  _month text default null,
  _team_id uuid default null,
  _limit int default 30,
  _offset int default 0
)
returns table (
  id uuid,
  type text,
  status text,
  processed_at timestamptz,
  week_number int,
  ir_type text,
  items jsonb,
  total_count bigint
)
language sql stable security definer set search_path to 'public' as $fn$
  with p as (
    select
      case when _month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           then make_timestamptz(split_part(_month, '-', 1)::int,
                                 split_part(_month, '-', 2)::int,
                                 1, 0, 0, 0, 'America/Sao_Paulo')
      end as m_start
  ),
  r as (
    select m_start,
           ((m_start at time zone 'America/Sao_Paulo') + interval '1 month')
             at time zone 'America/Sao_Paulo' as m_end
    from p
  ),
  f as (
    select
      t.id,
      t.type,
      t.status,
      coalesce(t.executed_at, t.admin_decided_at, t.updated_at) as processed_at,
      t.week_number,
      t.ir_type,
      count(*) over () as total_count
    from public.transactions t, r
    where t.status = 'executed'
      and (_season_id is null or t.season_id = _season_id)
      and (r.m_start is null or (
            coalesce(t.executed_at, t.admin_decided_at, t.updated_at) >= r.m_start
        and coalesce(t.executed_at, t.admin_decided_at, t.updated_at) <  r.m_end))
      and (_team_id is null or exists (
            select 1 from public.transaction_items x
            where x.transaction_id = t.id
              and (x.from_team_id = _team_id or x.to_team_id = _team_id)))
    order by coalesce(t.executed_at, t.admin_decided_at, t.updated_at) desc, t.id desc
    limit least(greatest(coalesce(_limit, 30), 1), 100)
    offset greatest(coalesce(_offset, 0), 0)
  )
  select
    f.id,
    f.type,
    f.status,
    f.processed_at,
    f.week_number,
    f.ir_type,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_type', ti.asset_type,
        'player', pl.full_name,
        'from', ft.name,
        'to', tt.name,
        'amount', ti.amount,
        'pick', case when ti.pick_id is not null
                     then (dp.round::text || 'ª · ' || coalesce(ds.label, '—'))
                     else null end
      ))
      from public.transaction_items ti
      left join public.players pl on pl.id = ti.player_id
      left join public.teams ft on ft.id = ti.from_team_id
      left join public.teams tt on tt.id = ti.to_team_id
      left join public.draft_picks dp on dp.id = ti.pick_id
      left join public.seasons ds on ds.id = dp.draft_season_id
      where ti.transaction_id = f.id
    ), '[]'::jsonb) as items,
    f.total_count
  from f
  order by f.processed_at desc, f.id desc;
$fn$;

grant execute on function public.get_movimentacoes_pagina(uuid, text, uuid, int, int) to anon, authenticated;
