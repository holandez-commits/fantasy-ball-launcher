-- 20261024_get_movimentacoes_paginado.sql
--
-- Filtros + paginação server-side para a tela /movimentacoes.
-- A get_movimentacoes(season, limit) original NÃO é alterada (fica como fallback).
--
--  1) get_movimentacoes_pagina(season, month, team, limit, offset)
--       - month: 'YYYY-MM' (fuso America/Sao_Paulo); NULL/inválido = sem filtro de mês
--       - team:  id do time em qualquer ponta (from/to) de algum item; NULL = todos
--       - devolve total_count (já com filtros) em cada linha, p/ "carregar mais"
--       - limit é limitado a 1..100; offset >= 0; desempate por id (paginação estável)
--  2) get_movimentacoes_filtros(season) -> jsonb { months: ['2026-10', ...], teams: [{id,name}] }
--       - só meses e times que têm movimentação executed (alimenta os seletores)
--  3) índices p/ ordenação por data e filtro por time
--
-- Mesmo modelo de segurança da original: SECURITY DEFINER, só status='executed',
-- dados denormalizados; execute p/ anon e authenticated.
--
-- Reversão:
--   drop function public.get_movimentacoes_pagina(uuid, text, uuid, int, int);
--   drop function public.get_movimentacoes_filtros(uuid);
--   drop index if exists public.transactions_executed_processed_at_idx;
--   drop index if exists public.transaction_items_from_team_idx;
--   drop index if exists public.transaction_items_to_team_idx;

create index if not exists transactions_executed_processed_at_idx
  on public.transactions ((coalesce(executed_at, admin_decided_at, updated_at)) desc, id desc)
  where status = 'executed';

create index if not exists transaction_items_from_team_idx
  on public.transaction_items (from_team_id, transaction_id);

create index if not exists transaction_items_to_team_idx
  on public.transaction_items (to_team_id, transaction_id);

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

create or replace function public.get_movimentacoes_filtros(_season_id uuid default null)
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select jsonb_build_object(
    'months', coalesce((
      select jsonb_agg(m order by m desc)
      from (
        select distinct to_char(
                 coalesce(t.executed_at, t.admin_decided_at, t.updated_at)
                   at time zone 'America/Sao_Paulo', 'YYYY-MM') as m
        from public.transactions t
        where t.status = 'executed'
          and (_season_id is null or t.season_id = _season_id)
      ) x
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name) order by tm.name)
      from public.teams tm
      where exists (
        select 1
        from public.transaction_items ti
        join public.transactions t on t.id = ti.transaction_id
        where t.status = 'executed'
          and (_season_id is null or t.season_id = _season_id)
          and (ti.from_team_id = tm.id or ti.to_team_id = tm.id)
      )
    ), '[]'::jsonb)
  );
$fn$;

grant execute on function public.get_movimentacoes_pagina(uuid, text, uuid, int, int) to anon, authenticated;
grant execute on function public.get_movimentacoes_filtros(uuid) to anon, authenticated;
