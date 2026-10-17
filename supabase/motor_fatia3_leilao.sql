-- ============================================================================
-- MOTOR DO MERCADO — Fatia 3: LEILÃO DE FREE AGENTS (signing)
-- Fluxo: GM dá lance (mercado fechado) -> admin roda a prévia -> admin consolida
--        (resolve a cascata + cria os signings, atômico).
--
-- RASCUNHO p/ revisão. Rodar no STAGING (pcpeopdnhsiqsmxhmntq) e validar com
-- testar_leilao.py ANTES de prod. Pré-req: fatia 1 aplicada (market_state semeado,
-- team_cap_usage). Nada destrutivo até CHAMAR as funções.
--
-- DECISÕES TRAVADAS NO PASSO 0 (sessão 5):
--  - POOL = foto de quarta: free agent = player que NÃO está em weekly_rosters(season,week).
--    Congela o pool; dispensado depois da foto NÃO entra no leilão da semana. Exige a
--    foto tirada (fechar_semana) — sem foto da semana, dar_lance recusa.
--  - POSIÇÃO: signing nasce com position = NULL (placeholder). Admin define depois; até
--    lá o jogador não é escalável nos slots posicionais (6H aceita qualquer um).
--  - CAP no dar_lance: lance ÚNICO <= cap disponível do time (não dá pra dar um lance que
--    você nunca pagaria sozinho). Vários lances PODEM somar acima do cap (otimista):
--    o cap/vaga de verdade é resolvido na cascata. Lance não "trava" cap.
--  - GATE: dar_lance exige mercado FECHADO (market_state.is_open=false). O resolver/commit
--    são ação de admin, sem gate de is_open (e NÃO reabrem o mercado — isso é da consolidação).
--  - Lance mínimo 750K (CHECK da tabela). Desempate: salário desc, depois created_at asc.
--    Editar um lance mantém o created_at original (prioridade da 1ª vez).
--
-- ALGORITMO (cascata, §4 do mercado_motor_v0):
--  Por jogador, ordena lances por (salário desc, created_at asc); vencedor = topo.
--  Itera até ponto fixo: cada time absorve seus vencidos NA ORDEM DE ENVIO (created_at),
--  pulando (=largando) lance que não cabe no cap e largando o resto quando acaba a vaga.
--  Lance largado cascateia pro próximo do jogador; nunca volta -> converge.
--  Baseline (cap/vaga) por time = estado AO VIVO (a "Fase 1" de fila está vazia hoje).
-- ============================================================================


-- ─── 1) dar_lance: GM registra/edita um lance (mercado fechado) ──────────────
create or replace function public.dar_lance(_player_id uuid, _salary_offer bigint, _week integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gm        uuid := public.current_gm_id();
  v_team      uuid := public.current_team_id();
  v_season_id uuid;
  v_open      boolean;
  v_avail     bigint;
  v_bid       uuid;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select id into v_season_id from public.seasons where is_current = true;

  -- gate: lances só com o mercado FECHADO
  select is_open into v_open from public.market_state where season_id = v_season_id;
  if coalesce(v_open, false) then
    raise exception 'Mercado aberto — lances de free agent estão fechados agora.';
  end if;

  if _salary_offer < 750000 then
    raise exception 'Lance mínimo é 750.000.';
  end if;

  if not exists (select 1 from public.players where id = _player_id) then
    raise exception 'Jogador % inexistente.', _player_id;
  end if;

  -- pool = foto de quarta: a foto da semana tem que existir, e o jogador não pode estar nela
  if not exists (select 1 from public.weekly_rosters
                 where season_id = v_season_id and week_number = _week) then
    raise exception 'A foto da semana % ainda não foi tirada (fechar_semana); pool de FA indefinido.', _week;
  end if;
  if exists (select 1 from public.weekly_rosters
             where season_id = v_season_id and week_number = _week and player_id = _player_id) then
    raise exception 'Jogador está em elenco nesta semana (não é free agent).';
  end if;

  -- cap: o lance único tem que caber no seu cap disponível atual
  select available into v_avail from public.team_cap_usage(v_season_id) where team_id = v_team;
  if _salary_offer > coalesce(v_avail, 0) then
    raise exception 'Lance % acima do seu cap disponível (%).', _salary_offer, coalesce(v_avail, 0);
  end if;

  -- upsert: 1 lance por (season,week,player,team). Editar mantém o created_at.
  select id into v_bid from public.free_agent_bids
  where season_id = v_season_id and week_number = _week and player_id = _player_id and team_id = v_team;

  if v_bid is not null then
    update public.free_agent_bids
       set salary_offer = _salary_offer, status = 'active', gm_id = v_gm
     where id = v_bid;
  else
    insert into public.free_agent_bids (season_id, week_number, player_id, team_id, gm_id, salary_offer)
    values (v_season_id, _week, _player_id, v_team, v_gm, _salary_offer)
    returning id into v_bid;
  end if;

  return v_bid;
end;
$function$;


-- ─── 2) retirar_lance: GM retira o próprio lance ────────────────────────────
create or replace function public.retirar_lance(_bid_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_team uuid := public.current_team_id();
  v_bidteam uuid;
begin
  select team_id into v_bidteam from public.free_agent_bids where id = _bid_id;
  if v_bidteam is null then raise exception 'Lance % não encontrado.', _bid_id; end if;
  if v_bidteam is distinct from v_team then
    raise exception 'Esse lance não é do seu time.';
  end if;

  update public.free_agent_bids set status = 'withdrawn' where id = _bid_id;
  return 'Lance retirado.';
end;
$function$;


-- ─── 3) leilao_resolver: núcleo da cascata (puro; não grava nada) ────────────
-- Devolve os VENCEDORES (player, team, salário). Reusado pela prévia e pelo commit.
create or replace function public.leilao_resolver(_season_id uuid, _week integer)
 returns table (player_id uuid, team_id uuid, salary_offer bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_start_year integer;
  v_drops      integer;
  v_team       record;
  v_w          record;
  v_reserva    integer;
  v_capuso     bigint;
begin
  select start_year into v_start_year from public.seasons where id = _season_id;

  -- lances elegíveis: ativos, >=750K, em jogador FORA da foto da semana (pool)
  drop table if exists _bids;
  create temp table _bids on commit drop as
    select b.id, b.player_id, b.team_id, b.salary_offer, b.created_at,
           row_number() over (partition by b.player_id
                               order by b.salary_offer desc, b.created_at asc, b.id) as rnk,
           false as dropped
    from public.free_agent_bids b
    where b.season_id = _season_id and b.week_number = _week and b.status = 'active'
      and b.salary_offer >= 750000
      and b.player_id not in (select wr.player_id from public.weekly_rosters wr
                               where wr.season_id = _season_id and wr.week_number = _week);

  -- baseline por time (AO VIVO): cap disponível e vagas livres (15 - ativos)
  drop table if exists _team_base;
  create temp table _team_base on commit drop as
    select t.id as team_id,
           coalesce(c.available, 0)::bigint as cap,
           (15 - coalesce((select count(*) from public.roster_entries re
                            where re.team_id = t.id and re.season = v_start_year
                              and re.status <> 'injured_reserve'), 0))::int as vaga
    from public.teams t
    left join public.team_cap_usage(_season_id) c on c.team_id = t.id
    where t.id in (select b.team_id from _bids b);

  drop table if exists _win;
  create temp table _win
    (bid_id uuid, player_id uuid, team_id uuid, salary_offer bigint, created_at timestamptz)
    on commit drop;

  loop
    -- vencedores provisórios: menor rnk não-largado por jogador
    truncate table _win;
    insert into _win
      select distinct on (b.player_id) b.id, b.player_id, b.team_id, b.salary_offer, b.created_at
      from _bids b
      where not b.dropped
      order by b.player_id, b.rnk;

    v_drops := 0;
    -- cada time absorve seus vencidos na ordem de ENVIO; baseline resetado a cada passada
    for v_team in
      select tb.team_id, tb.cap, tb.vaga from _team_base tb
      where tb.team_id in (select wn.team_id from _win wn)
    loop
      v_reserva := 0;
      v_capuso  := 0;
      for v_w in
        select * from _win w where w.team_id = v_team.team_id order by w.created_at, w.bid_id
      loop
        if v_reserva >= v_team.vaga then
          update _bids set dropped = true where id = v_w.bid_id;   -- sem vaga: larga este e, por ordem, os próximos
          v_drops := v_drops + 1;
        elsif v_capuso + v_w.salary_offer <= v_team.cap then
          v_reserva := v_reserva + 1;
          v_capuso  := v_capuso + v_w.salary_offer;                -- aceita
        else
          update _bids set dropped = true where id = v_w.bid_id;   -- não cabe no cap: pula (cascata)
          v_drops := v_drops + 1;
        end if;
      end loop;
    end loop;

    exit when v_drops = 0;   -- ponto fixo
  end loop;

  return query select w.player_id, w.team_id, w.salary_offer from _win w;
end;
$function$;


-- ─── 4) leilao_previa: relatório dos vencedores (admin, não aplica) ──────────
create or replace function public.leilao_previa(_season_id uuid, _week integer)
 returns table (player_id uuid, player_name text, team_id uuid, team_name text, salary_offer bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin vê a prévia do leilão.';
  end if;
  return query
    select r.player_id, p.full_name, r.team_id, t.name, r.salary_offer
    from public.leilao_resolver(_season_id, _week) r
    join public.players p on p.id = r.player_id
    join public.teams   t on t.id = r.team_id
    order by t.name, r.salary_offer desc;
end;
$function$;


-- ─── 5) leilao_commit: resolve + cria os signings (admin, ATÔMICO) ───────────
create or replace function public.leilao_commit(_season_id uuid, _week integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start_year integer;
  v_label      text;
  v_w          record;
  v_tx         uuid;
  v_re         uuid;
  v_signed     integer := 0;
  v_lost       integer := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin consolida o leilão.';
  end if;

  select start_year, label into v_start_year, v_label from public.seasons where id = _season_id;

  -- vencedores da cascata (snapshot em memória)
  drop table if exists _winners;
  create temp table _winners on commit drop as
    select * from public.leilao_resolver(_season_id, _week);

  for v_w in select * from _winners loop
    -- 1 signing por vencedor, já executado
    insert into public.transactions (type, status, season_id, week_number, proposed_by, executed_at)
    values ('signing', 'executed', _season_id, _week, null, now())
    returning id into v_tx;

    -- cria o vínculo (contrato de 1 temporada ao salário do lance). Posição = NULL (admin ajusta).
    insert into public.roster_entries (team_id, player_id, season, status, position, acquired_via)
    values (v_w.team_id, v_w.player_id, v_start_year, 'active', null, 'signing')
    returning id into v_re;

    insert into public.roster_contract_years (roster_entry_id, season_label, salary)
    values (v_re, v_label, v_w.salary_offer);

    -- ledger: item do jogador contratado (vem da free agency -> from_team null)
    insert into public.transaction_items (transaction_id, asset_type, player_id, to_team_id, amount)
    values (v_tx, 'player', v_w.player_id, v_w.team_id, v_w.salary_offer);

    -- marca o lance vencedor
    update public.free_agent_bids
       set status = 'won'
     where season_id = _season_id and week_number = _week
       and player_id = v_w.player_id and team_id = v_w.team_id and status = 'active';

    v_signed := v_signed + 1;
  end loop;

  -- todos os demais lances ativos da semana viram 'lost'
  update public.free_agent_bids
     set status = 'lost'
   where season_id = _season_id and week_number = _week and status = 'active';
  get diagnostics v_lost = row_count;

  return format('Leilão consolidado: %s contratação(ões), %s lance(s) perdedor(es).', v_signed, v_lost);
end;
$function$;
