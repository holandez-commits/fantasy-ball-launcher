-- 20261024_gms_contato_restrito.sql
-- Aplicado em 24/out/2026 (via MCP, PROD).
--
-- Problema: a policy "GMs are publicly viewable" (SELECT using true) + grant de SELECT
-- na tabela inteira deixava QUALQUER visitante (role anon, chave pública do site) ler
-- gms.email (24 e-mails) e gms.whatsapp pela API REST.
--
-- Correção: anon passa a ter SELECT só nas colunas públicas (as que a tela /gms usa).
-- authenticated mantém SELECT na tabela inteira (GMs logados veem contato dos outros).
-- Efeito colateral aceito: select("*") feito por anon em gms passa a dar
-- "permission denied" — nenhuma tela faz isso (conferido no código).
-- Novas colunas da gms NÃO ficam visíveis ao anon até serem liberadas explicitamente.
--
-- Reversão:
--   grant select on public.gms to anon;

revoke select on public.gms from anon;

grant select (id, full_name, nickname, bio, avatar_url, joined_year, user_id, created_at, updated_at)
  on public.gms to anon;
