-- s25 (25-26/11/2026): mensagens do GM nas trocas.
--   transactions.mensagem            = mensagem do proponente (propor_troca / contra-proposta), até 300 caracteres
--   transaction_approvals.mensagem   = mensagem de cada time ao aceitar ou recusar (aceitar_troca)
-- RLS já restringe as duas tabelas a admin + partes da troca => mensagens privadas.
-- NÃO entram no e-mail público da liga (email_snapshot/trg_email_tx_executed não foram alterados).
-- propor_troca(jsonb,int,timestamptz) e aceitar_troca(uuid,boolean) foram substituídas por versões com
-- parâmetro final `_mensagem text default null` (assinaturas antigas removidas para não gerar ambiguidade no RPC).
-- trg_notify_approval_insert / trg_notify_approval_answer: o aviso do sino leva 'Mensagem: "<até 200 chars>"'.
-- Aplicado em PROD via MCP (migration 20261125_mensagens_nas_trocas). Testado em rollback.
-- Corpo completo das funções: ver `select pg_get_functiondef('public.propor_troca'::regproc)` etc.
-- (o arquivo-fonte integral da migration está no histórico de migrations do Supabase).

alter table public.transactions add column if not exists mensagem text;
alter table public.transactions drop constraint if exists transactions_mensagem_len;
alter table public.transactions add constraint transactions_mensagem_len check (mensagem is null or char_length(mensagem) <= 300);
alter table public.transaction_approvals add column if not exists mensagem text;
alter table public.transaction_approvals drop constraint if exists transaction_approvals_mensagem_len;
alter table public.transaction_approvals add constraint transaction_approvals_mensagem_len check (mensagem is null or char_length(mensagem) <= 300);
