# Mercado — Motor e consolidação (v0)

Pareia com `mercado_schema_v0.sql`. Descreve o ciclo semanal, o modo de
processar movimentações, a consolidação de domingo e o algoritmo do leilão.

---

## 1. Calendário semanal — 4 momentos de admin

O ciclo separa eventos que hoje o `fechar_semana()` faz juntos. São quatro
ações distintas de admin na semana:

| Quando | Ação | O que faz |
|---|---|---|
| Seg ~20h | **Lock de escalação** | Cria `roster_locks` (prazo). Trava a escalação. **NÃO** tira foto. (metade do antigo `fechar_semana`) |
| Seg 20h+ | **Consolidar escalações** | `consolidar_lock` existente: copia a última escalação pra quem não escalou. Fonte de validação agora é o elenco ao vivo, não a foto |
| Qua 23h59 | **Fechar mercado + foto** | Tira `weekly_rosters` + `market_state.is_open=false`. (outra metade do antigo `fechar_semana`) |
| Dom 23h59 | **Consolidar mercado** | Processa a fila (dispensas+trocas), resolve o leilão, anuncia, reabre o mercado. (função NOVA) |

Fases do mercado entre esses momentos:

- **Seg 00h01 → Qua 23h59 — ABERTO.** Troca/dispensa processam na hora (pós-aval
  do admin). Lances de FA fechados. Escalação trava Seg ~20h; troca depois disso
  processa mas não mexe na escalação travada.
- **Qua 23h59 → Dom 23h59 — FECHADO.** Lances de FA abertos. Troca/dispensa
  entram na **fila**, não processam.
- **Dom 23h59 — CONSOLIDA + REABRE.**

**Papel do snapshot mudou:** `weekly_rosters` deixa de validar a escalação
(agora é o elenco ao vivo) e passa a definir **só** o pool de free agents da
semana (livre = não está na foto de quarta) e o baseline do leilão.

---

## 2. Modo de processar troca/dispensa depende de `is_open`

Mesma ação do GM; o que muda é **quando** roda:

- `is_open = true`  → executa agora (após aprovação do admin).
- `is_open = false` → fica `approved` na fila; executa na consolidação de domingo.

GM propõe a qualquer momento; admin aprova a qualquer momento. O gate de
execução é o `is_open` no instante da execução.

---

## 3. Consolidação de domingo — sequência

Admin, Dom 23h59, mercado fechado. Padrão **prévia → commit** (igual
`consolidar_lock`): a prévia simula tudo e retorna o relatório; o commit aplica.

**Fase 0 — guarda.** Só admin. Revalida que o mercado está fechado.

**Fase 1 — fila de dispensas + trocas** (antes do leilão; liberam vaga/cap e
geram multas). Processa em ordem FIFO (por `created_at` da transação).
Para cada uma, **revalida contra o estado ATUAL** (o mundo mudou desde a
aprovação na quinta):
- Troca: valida vaga + cap no destino de cada time no resultado final.
  Falhou o hard cap? → `status='failed'` + motivo, pula, segue. (salvo
  `admin_override=true`, que deixa furar).
- Dispensa: some o jogador do elenco **e** nasce a multa (se elegível) no
  mesmo ato atômico — ambos ou nada.
- Conflito (dois pedidos sobre o mesmo ativo): o primeiro FIFO vence, o
  segundo falha na revalidação.

**Fase 2 — leilão** (ver §4), usando vaga/cap já pós-Fase-1.

**Fase 3 — signings.** Cada vencedor do leilão vira `transaction` type
`signing`, executa atômico: consome vaga + cap, cria o vínculo de 1 temporada
ao salário do lance (contrato de FA dura só a temporada corrente).

**Fase 4 — anuncia + reabre.** `market_state.is_open = true`. Começa o
próximo ciclo (o lock de segunda é ação separada, depois).

---

## 4. Algoritmo do leilão (cascata)

Duas prioridades de níveis diferentes:
- **Entre times, no mesmo jogador:** maior salário leva; empate → quem enviou
  antes (`created_at`).
- **Dentro de um time que ganhou mais do que cabe:** mantém em ordem de
  **envio** (não por maior salário); lance que não cabe no cap é **pulado**
  (segue pro próximo), sem parar o time.

Lance mínimo: **750.000**. Lance não trava cap (otimista: posso dar 3 lances de
750K com 1M). Validação de cap/vaga só aqui.

Resolução iterativa até estabilizar (ponto fixo):

```
0. Baseline: vaga_livre[t] e cap_livre[t] por time, já pós-Fase-1.
1. Por jogador do pool, ordena lances por (salário desc, created_at asc).
   Descarta lances < 750K.
   winner[j] = topo da lista de j.

2. Repete até nenhum winner mudar:
   a. Para cada time t, vencidos[t] = { j : winner[j] == t }.
   b. Resolve a intake de t sobre vencidos[t], em ordem de ENVIO do lance:
        reserva = 0 ; capuso = 0
        para cada j (ordem created_at):
          se vaga_livre[t] - reserva == 0:  # sem vaga → larga este e os demais
            larga j
          senão se cap_livre[t] - capuso >= salario(t,j):
            aceita j ; reserva += 1 ; capuso += salario(t,j)
          senão:                            # não cabe no cap → pula, continua
            larga j
   c. Para cada lance LARGADO nesta passada:
        marca o lance como 'lost'
        avança winner[j] para o PRÓXIMO lance da lista de j  (cascata)
        (lista esgotou → j fica sem dono nesta semana)
   d. Se algum winner mudou, repete do (a) com baseline resetado.

3. Finaliza: para cada j com winner sobrevivente → signing (Fase 3);
   lance vencedor 'won', os demais do jogador 'lost'.
```

**Por que termina:** o winner de um jogador só anda **pra baixo** na lista; um
lance largado nunca volta. Monotônico e finito → converge.

**Exemplo (regra do §1 confirmada):** time com vaga pra 2, cap sobrando 1M,
lances em ordem P1=600K, P2=600K, P3=100K, todos ele liderando.
P1 aceita (cap→400K, vaga→1). P2 600K > 400K → larga (cascata pro 2º maior).
P3 100K cabe → aceita (cap→300K, vaga→0). Resultado: **P1 + P3**.

---

## 5. Hard cap no commit

Cap fixo **70.000.000**. Usado = salários de ativos (IR fora) + multas da
temporada (§6 da RPC). Toda execução (troca, signing) revalida no commit e
**bloqueia** estouro. `transactions.admin_override=true` é o único caminho que
deixa furar — registra quem e quando.

---

## 6. Impactos no que já existe (ripple do "validar ao vivo")

- **Trigger `validate_lineup_slot`:** troca a fonte de posse de `weekly_rosters`
  → `roster_entries` da temporada corrente. Posição e prazo iguais.
- **`fechar_semana()` se parte em dois:** lock (seg) e foto+close (qua).
- **`consolidar_lock`:** job igual (preenche quem não escalou), mas roda seg
  20h+ e valida contra o elenco ao vivo, não contra a foto (que nem existe
  ainda na segunda). Não confundir com a consolidação de **mercado** de domingo
  — são eventos diferentes.
- **Teste "semana 100" (10/10):** reescrever o invariante — a escalação agora
  valida contra `roster_entries`, não contra a foto. A estrutura do teste
  isolado serve; o que ele checa muda.

---

## 7. Defaults que assumi (confirmar ou corrigir)

- Fila de domingo processada **FIFO** por `created_at` da transação.
- Consolidação em **duas fases** (prévia simula + relatório → commit aplica).
- Troca enfileirada que falha o hard cap no commit → `failed` + motivo, não
  trava as outras.
- Multa de dispensa nasce no ato da execução; valor = função (salário ×
  duração) a preencher com a tabela de regras.
