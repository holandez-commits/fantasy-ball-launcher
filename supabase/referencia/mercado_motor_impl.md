# Mercado — plano de implementação (v1)

Aterrissa o `mercado_motor_v0.md` (design) no **schema REAL** já no banco (confirmado via
`types.ts`, Out/2026 sessão 3). Ordem de construção: **dispensa** (fatia 1, mais simples
ponta-a-ponta) → troca → leilão de FA → telas. Este doc detalha o scaffolding comum + a
dispensa. SQL vai pra `supabase/sql_aplicado/` conforme for aplicado.

---

## Convenções de `transactions` (header)

Colunas reais: `type`, `status`, `season_id`, `week_number`, `proposed_by` (gm),
`admin_decided_by`/`admin_decided_at`, `admin_override` (bool), `executed_at`, `notes`.

- **`type`**: `release` (dispensa) · `trade` (troca) · `signing` (contratação via leilão) · `ir`.
- **`status`**: `pending` (GM propôs) → `approved` (admin aprovou) → `executed` (aplicada)
  · `rejected` (admin recusou) · `failed` (revalidação falhou no commit — ex. estourou cap).
- `admin_override=true`: fura o hard cap (só admin).

`transaction_items` (linhas polimórficas): `asset_type` ∈ `player|pick|penalty`, com
`player_id`/`pick_id`/`source_penalty_id`, `from_team_id`/`to_team_id`, `amount`.

---

## Scaffolding comum (antes de qualquer tipo)

1. **Semear `market_state`** — hoje está VAZIA. 1 linha por temporada corrente, `is_open=true`
   pra começar. (Gate de "executa agora vs. fila de domingo" lê isto.)
2. **Helpers já existem**: `current_gm_id()`, `current_team_id()`, `has_role()`.
3. **Policies de escrita** das tabelas do mercado (nascem trancadas): entram com cada fatia,
   junto das telas. Por ora as funções são `SECURITY DEFINER` e fazem o gate de papel na mão.

---

## Fatia 1 — DISPENSA (release)

### Fluxo
`propor` (GM) → `aprovar` (admin) → `executar` (joga o jogador pro mercado + nasce a multa).

### Tabelas tocadas na execução
- `roster_entries`: **remove** a linha do jogador no time (contratos `roster_contract_years`
  caem por CASCADE). O histórico do que aconteceu fica na `transactions`.
- `team_penalties`: **nasce** a multa de dispensa (`source='release'`, `team_id`=time).
- `transaction_items`: 1 item `player` (quem saiu) + 1 item `penalty` (a multa gerada,
  `source_penalty_id`).

### Funções a criar
- **`propor_dispensa(_player_id uuid, _week int default null)`** [GM]
  Cria `transactions(type='release', status='pending', season_id=corrente, proposed_by=current_gm_id)`
  + `transaction_items(asset_type='player', player_id, from_team_id=current_team_id)`.
  Valida: o jogador é do time do GM (roster_entries ao vivo) e está ativo (não IR).
- **`decidir_transacao(_tx_id uuid, _aceitar bool, _override bool default false)`** [admin]
  `pending` → `approved`/`rejected`. Grava `admin_decided_by/at`, `admin_override`.
  (Genérica — serve pra todos os tipos.)
- **`executar_dispensa(_tx_id uuid)`** [admin, tx `approved`]  ← atômico, tudo-ou-nada
  1. Revalida: jogador ainda está no elenco do time (senão `failed`).
  2. `v_multa := calc_multa_dispensa(...)`.
  3. `delete from roster_entries` (o jogador + contratos).
  4. `insert into team_penalties(...)` → id da multa.
  5. `insert into transaction_items(asset_type='penalty', to_team_id=time, source_penalty_id, amount=v_multa)`.
  6. `status='executed'`, `executed_at=now()`.
  (Cap se resolve sozinho: `team_cap_usage` lê roster_entries ao vivo + multas.)

### ⚠️ Pendência que trava o fecho da dispensa
- **`calc_multa_dispensa(...)` — a FÓRMULA.** O doc diz: *faixa% × salário da tabela de
  multas, recorrendo por ano restante, arredondado a 50K* — mas as faixas (%) precisam ser
  **confirmadas com a liga** antes de codar. Opções até lá:
  - (A) função stub que RECUSA ("fórmula pendente"), e a gente só liga quando confirmar; OU
  - (B) `executar_dispensa` recebe a multa como **parâmetro** (admin digita), pra já dar pra
    estressar o fluxo ponta-a-ponta sem a fórmula. Bom pro ambiente de testes.
- **Multa é 1 linha ou N (uma por ano restante)?** O "recorrendo por ano restante" sugere N
  multas (uma por temporada futura do contrato). Confirmar junto da fórmula.

### Decisões a confirmar (defaults que assumo)
- **Gate de mercado**: na fatia 1, `executar_dispensa` roda na hora na aprovação (ignora
  `market_state.is_open`). A fila de domingo (executa depois) entra numa fatia posterior,
  junto da consolidação de mercado. Simplifica o 1º loop.
- **Delete vs. soft-delete** do `roster_entries`: delete (o registro do ato vive na
  `transactions`). Se quiser rastro no próprio elenco, vira um `status='released'` — decidir.

---

## Próximas fatias (esboço, detalhar quando chegar)
- **Troca**: `transaction_approvals` por time (aceite multi-time), itens player/pick/penalty
  circulando, revalida cap/vaga no commit. Multa divisível (mín 250K enviado).
- **Leilão FA**: `free_agent_bids` (salary_offer, mín 750K), algoritmo de cascata do §4 do
  `_v0.md`, resolvido na consolidação de domingo. Pool = quem não está na foto de quarta.
- **IR**: transação simples, tira de vaga/cap, retorno só na temporada seguinte.

---

## Ambiente de testes (decisão de infra — ver chat)
Resumo das duas opções pra estressar tudo com os admins antes do lançamento:
- **Projeto Supabase separado (staging)** — isola 100% o site real; UI funciona sem mexer
  (is_current aponta pro mundo de brincar). Custo: recriar schema (via `supabase db dump` do
  prod — que de bônus captura o DDL de auth/escalação que se perdeu) + seed + preview Cloudflare.
- **Temporada sandbox no mesmo projeto** — sem infra nova, mas exige o motor rigorosamente
  season-scoped + seletor de temporada nas telas de admin, e carrega risco de contaminar o
  elenco real 26/27 (que já está no ar) se alguma função esquecer o filtro de season.
Recomendação: **staging separado**, pelo risco (o site já é público com dado real).
