-- 20261019_get_movimentacoes.sql
-- Aplicado em 19/out/2026 (via MCP, PROD).
--
-- Feed PÚBLICO de movimentações para a tela /movimentacoes (dentro de "Liga").
-- transactions tem RLS restrito (só times envolvidos + admin), mas a tela é pública,
-- então a leitura passa por esta RPC SECURITY DEFINER, que só expõe o que foi
-- processado (status='executed') e em forma denormalizada/segura.
-- Datado por executed_at (quando a movimentação foi processada).
-- Reversão: drop function public.get_movimentacoes(uuid, int);

create or replace function public.get_movimentacoes(_season_id uuid default null, _limit int default 200)
returns table (
  id uuid,
  type text,
  status text,
  processed_at timestamptz,
  week_number int,
  items jsonb
)
language sql stable security definer set search_path to 'public' as $fn$
  select
    t.id,
    t.type,
    t.status,
    coalesce(t.executed_at, t.admin_decided_at, t.updated_at) as processed_at,
    t.week_number,
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
      where ti.transaction_id = t.id
    ), '[]'::jsonb) as items
  from public.transactions t
  where t.status = 'executed'
    and (_season_id is null or t.season_id = _season_id)
  order by coalesce(t.executed_at, t.admin_decided_at, t.updated_at) desc
  limit _limit;
$fn$;

grant execute on function public.get_movimentacoes(uuid, int) to anon, authenticated;
