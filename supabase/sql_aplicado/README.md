# SQL aplicado

Registro dos scripts SQL que **já foram aplicados no banco de produção** (via SQL Editor
do Supabase), guardados aqui como histórico versionado.

**Importante:** estes arquivos NÃO são migrations e NÃO são aplicados automaticamente por
nenhuma CLI. São um espelho do que já rodou no banco. Para aplicar algo novo: roda-se no
SQL Editor e salva-se o script aqui, no formato `AAAAMMDD_descricao.sql`.

A pasta irmã `../referencia/` guarda rascunhos de modelagem (NÃO rodados, NÃO autoritativos).

| Arquivo | Aplicado | O quê |
|---|---|---|
| `20261005_mercado_ddl_v1.sql` | 05/out/2026 | Tabelas novas do mercado + ALTERs + RPC `team_cap_usage` (cap fixo 70M). RLS ligado, sem policies. |
| `20261005_mercado_seed_v1.sql` | 05/out/2026 | Avança elencos 2025→2026, vira `is_current` p/ 26/27, resemeia 49 multas, insere 191 picks. |
| `20261006_draft_picks_select_policy.sql` | 06/out/2026 | Policy de leitura pública da `draft_picks` (p/ as telas de picks). |

> **Nota:** o DDL/seed de **auth + escalação** (Set/2026) foi aplicado direto no banco e o
> SQL original se perdeu — não está aqui. Se um dia precisar do baseline completo do schema,
> só via `supabase db dump` do banco vivo.
