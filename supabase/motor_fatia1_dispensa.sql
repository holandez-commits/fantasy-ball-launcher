-- ============================================================================
-- MOTOR DO MERCADO — Fatia 1: DISPENSA (release)
-- Fluxo: propor (GM) -> decidir (admin) -> executar (admin). Jogador sai do
-- elenco (delete; histórico fica na transactions) + nasce a multa por ano
-- restante do contrato (tabela de faixas, arredondado a 50K).
--
-- RASCUNHO p/ revisão. Onde rodar (prod vs staging) = decisão de ambiente ainda
-- aberta. Nada aqui é destrutivo de dado real até alguém CHAMAR as funções.
--
-- DECISÕES embutidas:
--  - Fatia 1 executa NA HORA (função executar_dispensa chamada após aprovar).
--    A fila de domingo (market_state fechado -> executa depois) entra em fatia
--    posterior; por ora o gate aberto/fechado é ignorado na dispensa.
--  - roster_entries: DELETE na dispensa (contratos caem por CASCADE). Ledger
--    completo (quem/quando/multa/admin) vive na transactions + transaction_items.
--  - ⚠️ FAIXA DOS 5M: implementado 5.000.000 = 10% (ao pé da tabela). Se o certo
--    for 15%, troca `_salary <= 5000000` por `_salary < 5000000` em multa_pct.
-- ============================================================================


-- ─── 0) Semear market_state (tabela está vazia) ─────────────────────────────
insert into public.market_state (season_id, is_open)
select id, true from public.seasons where is_current = true
on conflict (season_id) do nothing;


-- ─── 1) multa_pct: faixa de % pela TABELA DE MULTAS ─────────────────────────
create or replace function public.multa_pct(_salary bigint)
 returns numeric
 language sql
 immutable
as $function$
  select case
    when _salary <= 2000000  then 0.00   -- $0 a $2.000.000
    when _salary <= 5000000  then 0.10   -- $2.000.001 a $5.000.000   (⚠️ 5M aqui = 10%)
    when _salary <= 7000000  then 0.15   -- $5.000.001 a $7.000.000
    when _salary <= 10000000 then 0.20   -- $7.000.001 a $10.000.000
    else 0.25                            -- $10.000.001 ou mais
  end;
$function$;


-- ─── 2) propor_dispensa: GM propõe (status 'pending') ───────────────────────
create or replace function public.propor_dispensa(_player_id uuid, _week integer default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gm         uuid := public.current_gm_id();
  v_team       uuid := public.current_team_id();
  v_season_id  uuid;
  v_season_int integer;
  v_tx         uuid;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  -- posse ao vivo + ativo (IR/released não dispensa)
  if not exists (
    select 1 from public.roster_entries re
    where re.team_id = v_team and re.player_id = _player_id
      and re.season = v_season_int and re.status = 'active'
  ) then
    raise exception 'Jogador não está no elenco ativo do seu time.';
  end if;

  -- status inicial = 'proposed' (CHECK transactions_status_check: proposed/accepted/
  -- approved/rejected/cancelled/executed/failed; NÃO existe 'pending')
  insert into public.transactions (type, status, season_id, week_number, proposed_by)
  values ('release', 'proposed', v_season_id, _week, v_gm)
  returning id into v_tx;

  insert into public.transaction_items (transaction_id, asset_type, player_id, from_team_id)
  values (v_tx, 'player', _player_id, v_team);

  return v_tx;
end;
$function$;


-- ─── 3) decidir_transacao: admin aprova/recusa (GENÉRICA — serve a todos) ────
create or replace function public.decidir_transacao(_tx_id uuid, _aceitar boolean, _override boolean default false)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin decide transações.';
  end if;

  select status into v_status from public.transactions where id = _tx_id;
  if v_status is null then
    raise exception 'Transação % não encontrada.', _tx_id;
  end if;
  if v_status <> 'proposed' then
    raise exception 'Transação não está pendente (status atual: %).', v_status;
  end if;

  update public.transactions
     set status           = case when _aceitar then 'approved' else 'rejected' end,
         admin_decided_by = public.current_gm_id(),
         admin_decided_at = now(),
         admin_override   = _override,
         updated_at       = now()
   where id = _tx_id;

  return case when _aceitar then 'Transação aprovada.' else 'Transação recusada.' end;
end;
$function$;


-- ─── 4) executar_dispensa: aplica (atômico). tx tem que estar 'approved' ─────
create or replace function public.executar_dispensa(_tx_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tx             record;
  v_player         uuid;
  v_team           uuid;
  v_re_id          uuid;
  v_season_int     integer;
  v_cy             record;
  v_pct            numeric;
  v_amount         bigint;
  v_season_id_year uuid;
  v_pen_id         uuid;
  v_total_multa    bigint := 0;
  v_anos           integer := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin executa.';
  end if;

  select * into v_tx from public.transactions where id = _tx_id;
  if v_tx is null then raise exception 'Transação não encontrada.'; end if;
  if v_tx.type <> 'release' then
    raise exception 'Transação não é dispensa (type=%).', v_tx.type;
  end if;
  if v_tx.status <> 'approved' then
    raise exception 'Transação não está aprovada (status=%).', v_tx.status;
  end if;

  select ti.player_id, ti.from_team_id into v_player, v_team
  from public.transaction_items ti
  where ti.transaction_id = _tx_id and ti.asset_type = 'player'
  limit 1;

  select start_year into v_season_int from public.seasons where id = v_tx.season_id;

  -- revalida: jogador ainda no elenco ativo do time (o mundo pode ter mudado)
  select re.id into v_re_id
  from public.roster_entries re
  where re.team_id = v_team and re.player_id = v_player
    and re.season = v_season_int and re.status = 'active';

  if v_re_id is null then
    update public.transactions
       set status = 'failed', updated_at = now(),
           notes  = coalesce(notes || ' | ', '') || 'jogador não está mais no elenco ativo'
     where id = _tx_id;
    return 'Falhou: jogador não está mais no elenco ativo do time.';
  end if;

  -- multa por ano restante do contrato (faixa da tabela, arredondado a 50K)
  for v_cy in
    select cy.season_label, cy.salary
    from public.roster_contract_years cy
    where cy.roster_entry_id = v_re_id
    order by cy.season_label
  loop
    v_pct := public.multa_pct(v_cy.salary);
    if v_pct > 0 then
      v_amount := (round((v_cy.salary * v_pct) / 50000.0) * 50000)::bigint;
      if v_amount > 0 then
        select id into v_season_id_year from public.seasons where label = v_cy.season_label;
        insert into public.team_penalties (team_id, season_id, amount, source, origin_team_id)
        values (v_team, v_season_id_year, v_amount, 'release', v_team)
        returning id into v_pen_id;
        -- item de ledger só quando >= 250K (CHECK transaction_items_check1). Multa menor
        -- ainda nasce em team_penalties; só não vira item (o header + a multa já contam a história).
        if v_amount >= 250000 then
          insert into public.transaction_items (transaction_id, asset_type, to_team_id, source_penalty_id, amount)
          values (_tx_id, 'penalty', v_team, v_pen_id, v_amount);
        end if;
        v_total_multa := v_total_multa + v_amount;
        v_anos := v_anos + 1;
      end if;
    end if;
  end loop;

  -- remove do elenco (roster_contract_years cai por CASCADE); histórico na transaction
  delete from public.roster_entries where id = v_re_id;

  update public.transactions
     set status = 'executed', executed_at = now(), updated_at = now()
   where id = _tx_id;

  return format('Dispensa executada: jogador fora do elenco; %s multa(s) criada(s), total %s.',
                v_anos, v_total_multa);
end;
$function$;
