-- ============================================================================
-- MOTOR DO MERCADO — Fatia 5: CONSOLIDAÇÃO DE DOMINGO
-- RECUPERADO do STAGING via pg_get_functiondef (Out/2026, sessão 7) — o arquivo
-- original não tinha sido salvo no repo. Isto é o que está aplicado no staging.
-- Pareia com o mercado_motor_v0.md (§3). Ainda NÃO aplicado em PROD.
--
-- consolidar_mercado_previa(_week): relatório (fase, detalhe) do que o commit fará.
-- consolidar_mercado_commit(_week): Fase 0 guarda (mercado fechado) -> Fase 1 fila
--   release/trade APROVADAS em FIFO (reusa executar_dispensa/executar_troca) ->
--   Fase 2/3 leilao_commit -> Fase 4 reabre o mercado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consolidar_mercado_previa(_week integer)
 RETURNS TABLE(fase text, detalhe text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             format('%s -> %s (%s)', p.full_name, tm.name, r.salary_offer)
      from public.leilao_resolver(v_season, _week) r
      join public.players p on p.id = r.player_id
      join public.teams   tm on tm.id = r.team_id
    ) x
    order by x.g, x.ord;
end;
$function$;


CREATE OR REPLACE FUNCTION public.consolidar_mercado_commit(_week integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_season  uuid;
  v_open    boolean;
  v_tx      record;
  v_fila    integer := 0;
  v_leilao  text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin consolida o mercado.';
  end if;

  select id into v_season from public.seasons where is_current = true;

  -- Fase 0 — guarda: mercado tem que estar fechado
  select is_open into v_open from public.market_state where season_id = v_season;
  if coalesce(v_open, false) then
    raise exception 'Mercado está aberto; feche antes de consolidar.';
  end if;

  -- Fase 1 — fila de dispensas + trocas aprovadas, FIFO
  for v_tx in
    select id, type from public.transactions
    where season_id = v_season and status = 'approved' and type in ('release','trade')
    order by created_at, id
  loop
    if v_tx.type = 'release' then
      perform public.executar_dispensa(v_tx.id);
    else
      perform public.executar_troca(v_tx.id);
    end if;
    v_fila := v_fila + 1;
  end loop;

  -- Fase 2+3 — leilão (usa vaga/cap já pós-Fase-1)
  v_leilao := public.leilao_commit(v_season, _week);

  -- Fase 4 — reabre o mercado
  update public.market_state
     set is_open = true, changed_at = now()
   where season_id = v_season;

  return format('Consolidação concluída: %s da fila processada(s); %s; mercado reaberto.',
                v_fila, v_leilao);
end;
$function$;
