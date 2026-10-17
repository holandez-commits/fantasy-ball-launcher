-- ============================================================================
-- MOTOR DO MERCADO — Fatia 2 (UI): RLS de leitura da troca
-- Complementa motor_fatia1_ui.sql. A `transaction_approvals` nasceu com RLS ligado
-- e SEM policy -> o cliente lê VAZIO, então a tela de aceite da troca não funciona.
-- Aqui entra só o SELECT (as escritas continuam pelas RPCs SECURITY DEFINER:
-- propor_troca / aceitar_troca / cancelar_troca).
-- Usa os helpers SECURITY DEFINER do fatia1_ui (tx_involves_my_team / tx_proposed_by_me),
-- então NÃO há recursão. Idempotente. Rodar no STAGING.
-- ============================================================================

alter table public.transaction_approvals enable row level security;
drop policy if exists "Trade approvals visible to admin or parties" on public.transaction_approvals;
create policy "Trade approvals visible to admin or parties"
  on public.transaction_approvals for select
  to authenticated
  using (
    public.has_role('admin')
    or team_id = public.current_team_id()
    or public.tx_proposed_by_me(transaction_id)
    or public.tx_involves_my_team(transaction_id)
  );
