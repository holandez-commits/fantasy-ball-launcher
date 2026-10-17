-- ============================================================================
-- MOTOR DO MERCADO — Fatia 1 (UI): RLS de leitura + toggle do mercado
-- Complementa motor_fatia1_dispensa.sql. As tabelas do mercado nasceram com RLS
-- ligado e SEM policy de leitura -> o cliente (anon/authenticated) lê VAZIO.
-- Aqui entram:
--   (a) policies de SELECT: GM vê o do próprio time; admin vê tudo;
--   (b) market_state com leitura pública (pro banner, mesmo deslogado);
--   (c) RPC set_market_open: admin abre/fecha o mercado da temporada corrente.
-- As ESCRITAS continuam pelas RPCs SECURITY DEFINER (propor/decidir/executar),
-- então NÃO entram policies de INSERT/UPDATE aqui.
-- Idempotente. Rodar no STAGING primeiro.
--
-- ⚠️ ANTI-RECURSÃO: as policies de transactions e transaction_items NÃO podem se
-- referenciar cruzado direto (RLS de uma dispara a RLS da outra -> "infinite
-- recursion"). Os lookups cruzados vão em funções SECURITY DEFINER (ignoram RLS),
-- mesmo truque do has_role/current_* em user_roles.
-- ============================================================================

-- ─── Helpers SECURITY DEFINER (quebram o ciclo de RLS) ──────────────────────
-- "A transação _tx envolve o meu time?" (lê transaction_items sem RLS)
create or replace function public.tx_involves_my_team(_tx uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.transaction_items ti
    where ti.transaction_id = _tx
      and (ti.from_team_id = public.current_team_id()
           or ti.to_team_id = public.current_team_id())
  );
$function$;

-- "A transação _tx foi proposta por mim?" (lê transactions sem RLS)
create or replace function public.tx_proposed_by_me(_tx uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.transactions t
    where t.id = _tx and t.proposed_by = public.current_gm_id()
  );
$function$;

-- ─── market_state: leitura pública (banner de estado do mercado) ────────────
alter table public.market_state enable row level security;
drop policy if exists "Market state is publicly viewable" on public.market_state;
create policy "Market state is publicly viewable"
  on public.market_state for select
  to anon, authenticated
  using (true);

-- ─── transactions: admin vê tudo; GM vê as que envolvem o próprio time ──────
alter table public.transactions enable row level security;
drop policy if exists "Transactions visible to admin or own team" on public.transactions;
create policy "Transactions visible to admin or own team"
  on public.transactions for select
  to authenticated
  using (
    public.has_role('admin')
    or proposed_by = public.current_gm_id()
    or public.tx_involves_my_team(id)
  );

-- ─── transaction_items: segue a visibilidade da transação-mãe ───────────────
alter table public.transaction_items enable row level security;
drop policy if exists "Transaction items visible to admin or own team" on public.transaction_items;
create policy "Transaction items visible to admin or own team"
  on public.transaction_items for select
  to authenticated
  using (
    public.has_role('admin')
    or from_team_id = public.current_team_id()
    or to_team_id   = public.current_team_id()
    or public.tx_proposed_by_me(transaction_id)
  );

-- ─── set_market_open: admin abre/fecha o mercado da temporada corrente ──────
-- changed_by referencia auth.users(id) (ver DDL) -> usa auth.uid(), não gm_id.
create or replace function public.set_market_open(_is_open boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_season_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin altera o estado do mercado.';
  end if;

  select id into v_season_id from public.seasons where is_current = true;
  if v_season_id is null then
    raise exception 'Nenhuma temporada corrente.';
  end if;

  insert into public.market_state (season_id, is_open, changed_by, changed_at)
  values (v_season_id, _is_open, auth.uid(), now())
  on conflict (season_id) do update
    set is_open    = excluded.is_open,
        changed_by = excluded.changed_by,
        changed_at = now();

  return case when _is_open then 'Mercado aberto.' else 'Mercado fechado.' end;
end;
$function$;
