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
| `20261007_ripple_escalacao_ao_vivo.sql` | 07/out/2026 | Escalação valida contra `roster_entries` (ao vivo). Trigger `validate_lineup_slot` reescrito (+ recusa IR); `fechar_semana` dividido em `fechar_escalacao_semanal` (lock/seg) + `fechar_semana` (foto/qua); `consolidar_lock` → `consolidar_escalacoes_pendentes`. ⚠️ As telas de admin na branch `feature/auth-escalacao` chamam os nomes antigos — atualizar antes de usar/mergear |
| `20261007_fix_team_cap_usage_season_label.sql` | 07/out/2026 | Fix da RPC `team_cap_usage`: casava salário por `season_label` derivado '2026-27', mas o dado é '26/27' (= `seasons.label`) → reportava salário 0. Passou a usar `seasons.label` direto. Verificado contra a tela. |
| `20261019_calendario_2627_jogos.sql` | 19/out/2026 (MCP) | Insere os 468 jogos da 26/27 (17 semanas, 39 rodadas) como `scheduled`, placar NULL. Confrontos decodificados da planilha de calendário. |
| `20261019_rpcs_standings_status_final.sql` | 19/out/2026 (MCP) | `AND g.status='final'` nas RPCs `get_standings`/`team_season_standings`/`team_game_stats_totals` (senão somavam os jogos `scheduled` sem placar da 26/27). |
| `20261019_transactions_accept_deadline.sql` | 19/out/2026 (MCP) | `ALTER TABLE transactions ADD COLUMN accept_deadline` — ficou de fora na promoção do motor; `propor_troca` falhava sem ela. |
| `20261019_reconciliacao_ir_planilha.sql` | 19/out/2026 (MCP) | Marca 7 jogadores como `injured_reserve` (ir_since_season=2026). Na planilha o IR é **cor de fonte vermelha**, que o importador não captura → entraram como `active` e estouravam as 15 vagas. |
| `20261019_troca_mensagens_nome_time.sql` | 19/out/2026 (MCP) | `propor_troca`/`executar_troca`: nome do time (não UUID) nas mensagens de erro de cap/vaga. |
| `20261019_admin_impersonation.sql` | 19/out/2026 (MCP) | **TEMPORÁRIO (testes):** admins "agem como" qualquer time. Tabela `admin_impersonation` + RPCs `impersonate_team`/`stop_impersonating`/`current_impersonation`; `current_team_id`/`current_gm_id` viram impersonation-aware. Frontend: seletor na sidebar + banner. **Bloco de reversão no fim do arquivo.** |

> **Nota:** o DDL/seed de **auth + escalação** (Set/2026) foi aplicado direto no banco e o
> SQL original se perdeu — não está aqui. Se um dia precisar do baseline completo do schema,
> só via `supabase db dump` do banco vivo.
