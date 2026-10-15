-- =====================================================================
-- MERCADO — DDL das tabelas novas (Liga Bola Presa) — v0 / rascunho
-- Convenção: season_id uuid (FK seasons). Tradução ano<->uuid na
-- fronteira com roster_entries (mesmo padrão do fechar_semana).
--
-- PREMISSAS a confirmar no banco vivo (marcadas -- VERIFICAR):
--   teams.id, players.id, seasons.id, gms.id, team_penalties.id : uuid
--   Cap fixo: 70.000.000, nunca muda.
-- =====================================================================


-- 1) PICKS DE DRAFT  (não existe hoje; semear do arquivo de elencos) --
create table draft_picks (
  id                uuid primary key default gen_random_uuid(),
  draft_season_id   uuid not null references seasons(id),   -- de qual draft é a pick
  round             int  not null,
  original_team_id  uuid not null references teams(id),     -- dono de origem
  current_team_id   uuid not null references teams(id),     -- dono atual (muda na troca)
  pick_number       int,                                    -- null até sair a ordem
  is_used           boolean not null default false,
  player_id         uuid references players(id),            -- quem foi escolhido (depois)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on draft_picks (current_team_id);
create index on draft_picks (draft_season_id);
-- Pick NÃO consome os 15 slots nem cap até virar jogador.


-- 2) ESTADO DO MERCADO  (admin flipa por ora; regra de tempo depois) -
create table market_state (
  season_id   uuid primary key references seasons(id),
  is_open     boolean not null default false,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references auth.users(id)
);


-- 3) TRANSAÇÕES  (header) --------------------------------------------
create table transactions (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('trade','release','signing')),
  season_id         uuid not null references seasons(id),
  week_number       int,
  status            text not null default 'proposed'
                      check (status in ('proposed','accepted','approved',
                                        'rejected','cancelled','executed','failed')),
  proposed_by       uuid references gms(id),        -- null = signing gerado pelo leilão
  admin_decided_by  uuid references gms(id),
  admin_decided_at  timestamptz,
  admin_override    boolean not null default false, -- fura o hard cap (só admin)
  executed_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on transactions (season_id, status);
create index on transactions (type, status);


-- 3b) ACEITES por time  (troca multi-time: cada contraparte aceita) --
create table transaction_approvals (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references transactions(id) on delete cascade,
  team_id         uuid not null references teams(id),
  gm_id           uuid references gms(id),
  accepted        boolean,                           -- null = pendente
  decided_at      timestamptz,
  unique (transaction_id, team_id)
);
-- Troca só vira 'accepted' quando todas as linhas têm accepted=true.


-- 4) ITENS da transação  (polimórfico: player | pick | penalty) ------
create table transaction_items (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references transactions(id) on delete cascade,
  asset_type        text not null check (asset_type in ('player','pick','penalty')),
  player_id         uuid references players(id),
  pick_id           uuid references draft_picks(id),
  source_penalty_id uuid references team_penalties(id),  -- de qual multa saiu a fatia
  from_team_id      uuid references teams(id),  -- null = vem da free agency / origem externa
  to_team_id        uuid references teams(id),  -- null = dispensado p/ free agency
  amount            numeric,                    -- salário (signing) | valor da fatia (penalty)
  created_at        timestamptz not null default now(),

  -- coerência tipo <-> FK
  check (
    (asset_type='player'  and player_id is not null
                          and pick_id is null and source_penalty_id is null) or
    (asset_type='pick'    and pick_id is not null
                          and player_id is null and source_penalty_id is null) or
    (asset_type='penalty' and source_penalty_id is not null
                          and player_id is null and pick_id is null)
  ),

  -- multa divisível: mínimo de 250K ENVIADO (contínuo, não múltiplos).
  -- O resto que fica na multa de origem PODE ser < 250K.
  check (asset_type <> 'penalty' or amount >= 250000)
);
create index on transaction_items (transaction_id);
create index on transaction_items (player_id);
-- Troca 3+ times = 1 header + N itens. Dispensa = item(player, to=null) +
-- item(penalty gerada). "Dispensa X e contrata Y" cabe num header só, atômico.


-- 5) LANCES de leilão (free agency) ----------------------------------
create table free_agent_bids (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id),
  week_number   int  not null,
  player_id     uuid not null references players(id),
  team_id       uuid not null references teams(id),
  gm_id         uuid references gms(id),
  salary_offer  numeric not null check (salary_offer > 0),
  status        text not null default 'active'
                  check (status in ('active','won','lost','invalid','withdrawn')),
  created_at    timestamptz not null default now(),  -- CRÍTICO: prioridade/desempate
  unique (season_id, week_number, player_id, team_id)
);
create index on free_agent_bids
  (season_id, week_number, player_id, salary_offer desc, created_at);
-- Lance NÃO trava cap. Cap/espaço só são validados na consolidação.


-- 6) RPC DE CAP  (esqueleto — fixar colunas no banco vivo) -----------
-- VERIFICAR nomes reais: roster_contract_years (salário por ano) e
-- team_penalties (value, season). Cap usado = salários de ativos (IR fora)
-- + multas da temporada. Disponível = 70.000.000 - usado.
--
-- create or replace function team_cap_usage(_season_id uuid)
-- returns table (team_id uuid, salaries numeric, penalties numeric,
--                used numeric, available numeric)
-- language sql stable as $$
--   with sal as (
--     select re.team_id, coalesce(sum(cy.salary),0) as salaries   -- VERIFICAR colunas
--     from roster_entries re
--     join roster_contract_years cy on cy.<fk> = re.<id>          -- VERIFICAR join
--     where re.season = (select start_year from seasons where id = _season_id)
--       and re.status <> 'injured_reserve'                         -- IR fora do cap
--     group by re.team_id
--   ),
--   pen as (
--     select tp.team_id, coalesce(sum(tp.value),0) as penalties    -- VERIFICAR colunas
--     from team_penalties tp
--     where tp.season_id = _season_id
--     group by tp.team_id
--   )
--   select t.id,
--          coalesce(sal.salaries,0),
--          coalesce(pen.penalties,0),
--          coalesce(sal.salaries,0) + coalesce(pen.penalties,0),
--          70000000 - (coalesce(sal.salaries,0) + coalesce(pen.penalties,0))
--   from teams t
--   left join sal on sal.team_id = t.id
--   left join pen on pen.team_id = t.id
--   where t.is_active;
-- $$;


-- 7) MUDANÇAS em tabelas EXISTENTES (confirmar schema antes) ---------
-- team_penalties: precisa de dono MUTÁVEL (team_id), season_id, value,
--   origin_team_id (quem gerou), source ('release'|'manual'|'traded').
--   VERIFICAR quais já existem.
-- roster_entries: status suportando 'injured_reserve'. IR só retorna na
--   temporada seguinte → registrar a temporada em que foi pro IR (ou impedir
--   reativação na mesma season). Setável por GM + confirmação do admin.
