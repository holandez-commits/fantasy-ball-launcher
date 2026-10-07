-- =====================================================================
-- MERCADO — DDL v1 (schema REAL, confirmado no passo 0 — Out/2026)
-- Rodar ANTES do mercado_seed_v1.sql. Nada aqui depende de is_current.
-- Baseado em: team_penalties.amount (bigint), roster_entries.season (int),
-- roster_contract_years.salary (bigint, season_label text '2026-27').
-- =====================================================================

-- 1) PICKS DE DRAFT ----------------------------------------------------
create table draft_picks (
  id               uuid primary key default gen_random_uuid(),
  draft_season_id  uuid not null references seasons(id),
  round            int  not null check (round in (1,2)),
  original_team_id uuid not null references teams(id),
  current_team_id  uuid not null references teams(id),
  disputed         boolean not null default false,  -- conflito na planilha; admin resolve pelo histórico
  pick_number      int,                             -- null até sair a ordem
  is_used          boolean not null default false,
  player_id        uuid references players(id),     -- quem foi escolhido (depois)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on draft_picks (current_team_id);
create index on draft_picks (draft_season_id);
create index on draft_picks (disputed) where disputed;

-- 2) ESTADO DO MERCADO -------------------------------------------------
create table market_state (
  season_id   uuid primary key references seasons(id),
  is_open     boolean not null default false,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references auth.users(id)
);

-- 3) TRANSAÇÕES (header). type inclui 'ir' (5º tipo na fila do admin) ---
create table transactions (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('trade','release','signing','ir')),
  season_id         uuid not null references seasons(id),
  week_number       int,
  status            text not null default 'proposed'
                      check (status in ('proposed','accepted','approved',
                                        'rejected','cancelled','executed','failed')),
  proposed_by       uuid references gms(id),   -- null = signing gerado pelo leilão
  admin_decided_by  uuid references gms(id),
  admin_decided_at  timestamptz,
  admin_override    boolean not null default false,  -- fura o hard cap (só admin)
  executed_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on transactions (season_id, status);
create index on transactions (type, status);

-- 3b) ACEITES por time (troca multi-time) ------------------------------
create table transaction_approvals (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references transactions(id) on delete cascade,
  team_id         uuid not null references teams(id),
  gm_id           uuid references gms(id),
  accepted        boolean,                     -- null = pendente
  decided_at      timestamptz,
  unique (transaction_id, team_id)
);

-- 4) ITENS (polimórfico: player | pick | penalty). amount BIGINT -------
create table transaction_items (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references transactions(id) on delete cascade,
  asset_type        text not null check (asset_type in ('player','pick','penalty')),
  player_id         uuid references players(id),
  pick_id           uuid references draft_picks(id),
  source_penalty_id uuid references team_penalties(id),  -- de qual multa saiu a fatia
  from_team_id      uuid references teams(id),  -- null = vem da free agency
  to_team_id        uuid references teams(id),  -- null = dispensado p/ free agency
  amount            bigint,                     -- salário (signing) | valor da fatia (penalty)
  created_at        timestamptz not null default now(),
  check (
    (asset_type='player'  and player_id is not null
                          and pick_id is null and source_penalty_id is null) or
    (asset_type='pick'    and pick_id is not null
                          and player_id is null and source_penalty_id is null) or
    (asset_type='penalty' and source_penalty_id is not null
                          and player_id is null and pick_id is null)
  ),
  check (asset_type <> 'penalty' or amount >= 250000)  -- piso de 250K enviado
);
create index on transaction_items (transaction_id);
create index on transaction_items (player_id);

-- 5) LANCES de leilão (free agency). piso 750K ------------------------
create table free_agent_bids (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id),
  week_number   int  not null,
  player_id     uuid not null references players(id),
  team_id       uuid not null references teams(id),
  gm_id         uuid references gms(id),
  salary_offer  bigint not null check (salary_offer >= 750000),
  status        text not null default 'active'
                  check (status in ('active','won','lost','invalid','withdrawn')),
  created_at    timestamptz not null default now(),  -- CRÍTICO: prioridade/desempate
  unique (season_id, week_number, player_id, team_id)
);
create index on free_agent_bids
  (season_id, week_number, player_id, salary_offer desc, created_at);

-- 6) ALTERs em tabelas EXISTENTES -------------------------------------
-- team_penalties: dono mutável já é o próprio team_id. Falta origem e fonte.
alter table team_penalties
  add column origin_team_id uuid references teams(id),
  add column source text check (source in ('release','manual','traded'));

-- roster_entries: IR só retorna na temporada seguinte -> guarda a season do IR.
alter table roster_entries
  add column ir_since_season int;

-- 7) INTEGRIDADE -------------------------------------------------------
-- ATENÇÃO: rode o pre-check ABAIXO antes do unique index. Se vier qualquer
-- linha, há contrato duplicado por ano e o índice falha — resolver antes.
--   select roster_entry_id, season_label, count(*)
--   from roster_contract_years group by 1,2 having count(*) > 1;
create unique index if not exists uq_rcy_entry_label
  on roster_contract_years (roster_entry_id, season_label);
create index if not exists ix_rcy_entry on roster_contract_years (roster_entry_id);
create index if not exists ix_tp_team_season on team_penalties (team_id, season_id);

-- 8) RPC DE CAP --------------------------------------------------------
-- Cap fixo 70.000.000. Usado = salários de ativos (IR fora) do ano corrente
-- + multas da temporada. O salário do ano vem do season_label de 4 dígitos
-- derivado do start_year (2026 -> '2026-27'); re.season = start_year.
create or replace function team_cap_usage(_season_id uuid)
returns table (team_id uuid, salaries bigint, penalties bigint,
               used bigint, available bigint)
language sql stable as $$
  with s as (select start_year as yr from seasons where id = _season_id),
  lbl as (
    select (select yr from s) as yr,
           (select yr from s)::text || '-' || right(((select yr from s)+1)::text,2) as season_label
  ),
  sal as (
    select re.team_id, coalesce(sum(cy.salary),0)::bigint as salaries
    from roster_entries re
    join roster_contract_years cy
      on cy.roster_entry_id = re.id
     and cy.season_label = (select season_label from lbl)
    where re.season = (select yr from lbl)
      and re.status <> 'injured_reserve'
    group by re.team_id
  ),
  pen as (
    select tp.team_id, coalesce(sum(tp.amount),0)::bigint as penalties
    from team_penalties tp
    where tp.season_id = _season_id
    group by tp.team_id
  )
  select t.id,
         coalesce(sal.salaries,0)::bigint,
         coalesce(pen.penalties,0)::bigint,
         (coalesce(sal.salaries,0) + coalesce(pen.penalties,0))::bigint,
         (70000000 - coalesce(sal.salaries,0) - coalesce(pen.penalties,0))::bigint
  from teams t
  left join sal on sal.team_id = t.id
  left join pen on pen.team_id = t.id
  where t.is_active;
$$;

-- Sanidade pós-seed: nenhum time deveria exceder 70M na 26/27.
--   select t.name, c.* from team_cap_usage((select id from seasons where start_year=2026)) c
--   join teams t on t.id=c.team_id where c.available < 0 order by c.available;
