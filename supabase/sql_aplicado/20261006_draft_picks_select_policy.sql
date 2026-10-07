-- Aplicado em 2026-10-06 via SQL Editor (Supabase).
-- Leitura pública da draft_picks, no mesmo padrão das demais tabelas de leitura
-- (teams, roster_entries, players, gms...).
-- Contexto: a tabela nasceu com RLS ligado e SEM policy (DDL do mercado, 05/out),
-- então o anon lia vazio. Esta policy libera o SELECT para as telas de picks.
-- Policies de ESCRITA (admin aprova, GM propoe) entram depois, com o motor do mercado.

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Draft picks are publicly viewable" ON public.draft_picks;
CREATE POLICY "Draft picks are publicly viewable"
  ON public.draft_picks FOR SELECT
  TO anon, authenticated
  USING (true);
