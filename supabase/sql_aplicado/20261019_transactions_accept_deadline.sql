-- 20261019 — Faltava a coluna accept_deadline na tabela transactions no PROD
-- (ficou de fora na promoção do motor no go-live). propor_troca a insere e
-- expirar_trocas a lê, então 'Propor troca' falhava com
-- "column accept_deadline of relation transactions does not exist".
-- Aditivo e seguro. Rodado via MCP no PROD (sessão 11).
alter table public.transactions add column if not exists accept_deadline timestamptz;
