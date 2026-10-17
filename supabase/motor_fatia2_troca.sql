-- ============================================================================
-- MOTOR DO MERCADO — Fatia 2: TROCA (trade)
-- Fluxo: propor (GM) -> aceites de cada time (GM) -> decidir (admin) -> executar
--        (admin, atômico). Jogadores/picks/multas circulam no mesmo header.
--
-- RASCUNHO p/ revisão. Rodar no STAGING (pcpeopdnhsiqsmxhmntq) e validar com
-- testar_troca.py ANTES de qualquer coisa em prod. Nada aqui é destrutivo de
-- dado real até alguém CHAMAR as funções.
--
-- Reusa o padrão da fatia 1 (SECURITY DEFINER + gate de papel na mão; status
-- 'proposed'; transaction_items de penalty exige amount>=250K via CHECK).
--
-- DECISÕES TRAVADAS NO PASSO 0 (sessão 5):
--  - Máquina de estados da troca:
--      proposed --(todos os times aceitam)--> accepted --(admin aprova)--> approved
--              --(admin executa, atômico)--> executed   |  revalidação falha -> failed
--      qualquer time recusa -> rejected   |  proponente cancela -> cancelled
--  - decidir_transacao passa a ser type-aware: trade exige 'accepted'; os demais
--    tipos (release/ir/signing) continuam exigindo 'proposed' (dispensa intacta).
--  - Parte = qualquer time em from/to de algum item. Proponente tem que ser parte
--    e sua linha de aceite nasce accepted=true (propor = consentir). Mín 2 times.
--  - Jogador em IR NÃO troca (item player exige status='active' no propor E no commit).
--  - Pick com disputed=true ou is_used=true NÃO troca.
--  - Multa divisível: mín 250K ENVIADO; o resto que fica na origem pode ser <250K.
--    Fatia de QUALQUER temporada pode circular; receber multa custa cap.
--  - admin_override=true fura o hard cap de 70M E o limite de 15 vagas (ambos),
--    MAS só no commit (executar). O propor é sempre estrito.
--  - VIABILIDADE DE CAP/VAGA JÁ NO PROPOR: não dá pra PROPOR troca que deixaria
--    algum time parte acima de 70M ou com >15 ativos (simulação via troca_projecao,
--    estrita, sem override). O commit revalida contra o estado AO VIVO — aí sim o
--    admin_override pode furar, pros casos que derivaram entre propor e executar.
--  - PRAZO DE ACEITE (accept_deadline em transactions): o proponente define; default
--    now()+7 dias, editável por ele; tem que ser no futuro. Aceite depois do prazo é
--    recusado e a troca vira 'cancelled'. expirar_trocas() varre as vencidas (cron/admin).
--  - Execução NA HORA na aprovação (ignora market_state.is_open). A fila de
--    domingo/consolidação é fatia posterior.
--  - Gate aberto/fechado e interação com escalação travada ficam FORA desta fatia.
--
-- ⚠️ EFEITO COLATERAL conhecido: quando uma multa de origem é totalmente consumida
--    por fatias, ela vira uma linha team_penalties com amount=0 (cap-neutra). Não dá
--    pra deletar (transaction_items.source_penalty_id a referencia, FK sem cascade).
--    A tela /times deve filtrar amount>0 ao listar multas — anotar como ajuste de UI.
-- ============================================================================


-- ─── ALTER: prazo de aceite da troca (aditivo, idempotente) ─────────────────
alter table public.transactions
  add column if not exists accept_deadline timestamptz;


-- ─── 0) troca_projecao: cap e vaga PROJETADOS por time parte, pós-troca ──────
-- Dry-run aritmético (NÃO aplica nada): usado + salários/fatias que entram/saem,
-- e nº de ativos +entradas/-saídas. Fatia de multa só pesa se for da temporada
-- corrente (Q4). Pick não afeta. Reusável: propor_troca valida com isto, e a UI
-- pode mostrar a prévia. Lê transaction_items -> chamar com a troca já criada.
create or replace function public.troca_projecao(_tx_id uuid)
 returns table (team_id uuid, new_used bigint, new_slots integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with cur as (select id sid, label lbl, start_year yr from public.seasons where is_current = true),
  items as (select * from public.transaction_items where transaction_id = _tx_id),
  psal as (  -- salário da temporada corrente de cada jogador trocado (contrato segue o jogador)
    select i.id, coalesce(sum(cy.salary),0)::bigint sal
    from items i
    join public.roster_entries re
      on re.player_id = i.player_id and re.team_id = i.from_team_id
     and re.season = (select yr from cur) and re.status = 'active'
    left join public.roster_contract_years cy
      on cy.roster_entry_id = re.id and cy.season_label = (select lbl from cur)
    where i.asset_type = 'player'
    group by i.id
  ),
  delta as (
    select i.from_team_id team, (-coalesce(ps.sal,0))::bigint dsal, 0::bigint dpen, -1 dslot
    from items i left join psal ps on ps.id = i.id where i.asset_type = 'player'
    union all
    select i.to_team_id, coalesce(ps.sal,0)::bigint, 0::bigint, 1
    from items i left join psal ps on ps.id = i.id where i.asset_type = 'player'
    union all  -- fatia de multa: só a da temporada corrente mexe no cap de agora
    select i.from_team_id, 0::bigint, (-i.amount)::bigint, 0
    from items i join public.team_penalties tp on tp.id = i.source_penalty_id
    where i.asset_type = 'penalty' and tp.season_id = (select sid from cur)
    union all
    select i.to_team_id, 0::bigint, i.amount::bigint, 0
    from items i join public.team_penalties tp on tp.id = i.source_penalty_id
    where i.asset_type = 'penalty' and tp.season_id = (select sid from cur)
  ),
  agg as (select team, sum(dsal)::bigint dsal, sum(dpen)::bigint dpen, sum(dslot)::int dslot
          from delta group by team)
  select a.team,
         (c.used + a.dsal + a.dpen)::bigint,
         ((select count(*) from public.roster_entries re
             where re.team_id = a.team and re.season = (select yr from cur)
               and re.status <> 'injured_reserve') + a.dslot)::int
  from agg a
  join public.team_cap_usage((select sid from cur)) c on c.team_id = a.team;
$function$;


-- ─── 1) propor_troca: GM monta a troca (status 'proposed') ──────────────────
-- _itens: jsonb ARRAY. Cada objeto:
--   player : {"asset_type":"player","player_id":"<uuid>","from_team_id":"<uuid>","to_team_id":"<uuid>"}
--   pick   : {"asset_type":"pick","pick_id":"<uuid>","from_team_id":"<uuid>","to_team_id":"<uuid>"}
--   penalty: {"asset_type":"penalty","source_penalty_id":"<uuid>","from_team_id":"<uuid>","to_team_id":"<uuid>","amount":250000}
--
-- IMPORTANTE: dropa a assinatura antiga de 2 args. O prazo de aceite adicionou um 3º
-- parâmetro; sem o drop, o create cria um OVERLOAD e o PostgREST recusa (PGRST203 —
-- "could not choose the best candidate function").
drop function if exists public.propor_troca(jsonb, integer);
create or replace function public.propor_troca(_itens jsonb, _week integer default null,
                                               _accept_deadline timestamptz default null)
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
  v_deadline   timestamptz;
  v_teams      uuid[];
  v_t          uuid;
  v_e          jsonb;
  v_at         text;
  v_from       uuid;
  v_to         uuid;
  v_pid        uuid;
  v_kid        uuid;
  v_sid        uuid;
  v_amt        bigint;
  v_used       boolean;
  v_disp       boolean;
  v_owner      uuid;
  v_penteam    uuid;
  v_penamt     bigint;
  v_chk        record;
  v_proj       record;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'A troca precisa de ao menos um item.';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  -- prazo de aceite: default 7 dias, editável; tem que ser no futuro
  v_deadline := coalesce(_accept_deadline, now() + interval '7 days');
  if v_deadline <= now() then
    raise exception 'O prazo de aceite tem que ser no futuro.';
  end if;

  -- times parte (from ∪ to). Mín 2; proponente tem que estar entre eles.
  select array_agg(distinct tm) into v_teams from (
    select (e->>'from_team_id')::uuid tm from jsonb_array_elements(_itens) e
    union
    select (e->>'to_team_id')::uuid     from jsonb_array_elements(_itens) e
  ) s where tm is not null;

  if array_length(v_teams, 1) is null or array_length(v_teams, 1) < 2 then
    raise exception 'A troca precisa envolver ao menos 2 times distintos.';
  end if;
  if not (v_team = any(v_teams)) then
    raise exception 'Você só pode propor trocas que envolvem o seu time.';
  end if;

  -- validação por item (posse ao vivo + regras de ativo)
  for v_e in select e from jsonb_array_elements(_itens) e loop
    v_at   := v_e->>'asset_type';
    v_from := (v_e->>'from_team_id')::uuid;
    v_to   := (v_e->>'to_team_id')::uuid;
    if v_from is null or v_to is null then
      raise exception 'Item sem time de origem/destino.';
    end if;
    if v_from = v_to then
      raise exception 'Item com origem igual ao destino.';
    end if;

    if v_at = 'player' then
      v_pid := (v_e->>'player_id')::uuid;
      if v_pid is null then raise exception 'Item player sem player_id.'; end if;
      if not exists (
        select 1 from public.roster_entries re
        where re.team_id = v_from and re.player_id = v_pid
          and re.season = v_season_int and re.status = 'active'
      ) then
        raise exception 'Jogador % não está ativo no elenco do time de origem (IR/ausente não troca).', v_pid;
      end if;

    elsif v_at = 'pick' then
      v_kid := (v_e->>'pick_id')::uuid;
      if v_kid is null then raise exception 'Item pick sem pick_id.'; end if;
      select is_used, disputed, current_team_id into v_used, v_disp, v_owner
      from public.draft_picks where id = v_kid;
      if not found then raise exception 'Pick % inexistente.', v_kid; end if;
      if v_owner is distinct from v_from then raise exception 'Pick % não pertence ao time de origem.', v_kid; end if;
      if v_used then raise exception 'Pick % já foi usada.', v_kid; end if;
      if v_disp then raise exception 'Pick % está em disputa — admin resolve antes de negociar.', v_kid; end if;

    elsif v_at = 'penalty' then
      v_sid := (v_e->>'source_penalty_id')::uuid;
      v_amt := (v_e->>'amount')::bigint;
      if v_sid is null then raise exception 'Item penalty sem source_penalty_id.'; end if;
      if v_amt is null or v_amt < 250000 then raise exception 'Fatia de multa mínima é 250.000 (enviado).'; end if;
      select team_id into v_penteam from public.team_penalties where id = v_sid;
      if not found then raise exception 'Multa % inexistente.', v_sid; end if;
      if v_penteam is distinct from v_from then raise exception 'Multa % não pertence ao time de origem.', v_sid; end if;

    else
      raise exception 'asset_type inválido: %', v_at;
    end if;
  end loop;

  -- soma das fatias por multa de origem não pode passar o saldo (vários itens na mesma multa)
  for v_chk in
    select (e->>'source_penalty_id')::uuid src, sum((e->>'amount')::bigint) req
    from jsonb_array_elements(_itens) e
    where e->>'asset_type' = 'penalty'
    group by 1
  loop
    select amount into v_penamt from public.team_penalties where id = v_chk.src;
    if v_chk.req > v_penamt then
      raise exception 'Soma das fatias (%) excede o saldo da multa % (%).', v_chk.req, v_chk.src, v_penamt;
    end if;
  end loop;

  -- header
  insert into public.transactions (type, status, season_id, week_number, proposed_by, accept_deadline)
  values ('trade', 'proposed', v_season_id, _week, v_gm, v_deadline)
  returning id into v_tx;

  -- itens
  for v_e in select e from jsonb_array_elements(_itens) e loop
    v_at := v_e->>'asset_type';
    insert into public.transaction_items
      (transaction_id, asset_type, player_id, pick_id, source_penalty_id, from_team_id, to_team_id, amount)
    values (
      v_tx, v_at,
      case when v_at = 'player'  then (v_e->>'player_id')::uuid end,
      case when v_at = 'pick'    then (v_e->>'pick_id')::uuid end,
      case when v_at = 'penalty' then (v_e->>'source_penalty_id')::uuid end,
      (v_e->>'from_team_id')::uuid,
      (v_e->>'to_team_id')::uuid,
      case when v_at = 'penalty' then (v_e->>'amount')::bigint end
    );
  end loop;

  -- VIABILIDADE DE CAP/VAGA (estrita, sem override): recusa já no propor se algum
  -- time parte estouraria o teto 70M ou as 15 vagas. Roda com os itens já inseridos;
  -- qualquer raise aqui faz ROLLBACK de toda a proposta (nada persiste).
  for v_proj in select * from public.troca_projecao(v_tx) loop
    if v_proj.new_used > 70000000 then
      raise exception 'Troca inviável: o time % ficaria com cap de % (teto 70M).',
        v_proj.team_id, v_proj.new_used;
    end if;
    if v_proj.new_slots > 15 then
      raise exception 'Troca inviável: o time % ficaria com % jogadores ativos (máx 15).',
        v_proj.team_id, v_proj.new_slots;
    end if;
  end loop;

  -- aceites: 1 linha por time; a do proponente já nasce aceita
  foreach v_t in array v_teams loop
    insert into public.transaction_approvals (transaction_id, team_id, gm_id, accepted, decided_at)
    values (
      v_tx, v_t,
      case when v_t = v_team then v_gm end,
      case when v_t = v_team then true end,
      case when v_t = v_team then now() end
    );
  end loop;

  return v_tx;
end;
$function$;


-- ─── 2) aceitar_troca: GM de um time parte aceita/recusa a sua linha ─────────
create or replace function public.aceitar_troca(_tx_id uuid, _aceitar boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_team     uuid := public.current_team_id();
  v_gm       uuid := public.current_gm_id();
  v_type     text;
  v_status   text;
  v_deadline timestamptz;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select type, status, accept_deadline into v_type, v_status, v_deadline
  from public.transactions where id = _tx_id;
  if v_status is null then raise exception 'Transação % não encontrada.', _tx_id; end if;
  if v_type <> 'trade' then raise exception 'Transação % não é troca.', _tx_id; end if;
  if v_status <> 'proposed' then
    raise exception 'A troca não está mais em fase de aceite (status %).', v_status;
  end if;

  if not exists (
    select 1 from public.transaction_approvals
    where transaction_id = _tx_id and team_id = v_team
  ) then
    raise exception 'Seu time não é parte desta troca.';
  end if;

  -- prazo vencido: cancela e avisa (não dá pra aceitar troca expirada)
  if v_deadline is not null and now() > v_deadline then
    update public.transactions
       set status = 'cancelled', updated_at = now(),
           notes  = coalesce(notes || ' | ', '') || 'prazo de aceite expirado'
     where id = _tx_id;
    return 'Prazo de aceite expirado; troca cancelada.';
  end if;

  update public.transaction_approvals
     set accepted = _aceitar, gm_id = v_gm, decided_at = now()
   where transaction_id = _tx_id and team_id = v_team;

  if not _aceitar then
    update public.transactions set status = 'rejected', updated_at = now() where id = _tx_id;
    return 'Troca recusada pelo seu time.';
  end if;

  -- aceitou: todos os times já aceitaram?
  if not exists (
    select 1 from public.transaction_approvals
    where transaction_id = _tx_id and accepted is distinct from true
  ) then
    update public.transactions set status = 'accepted', updated_at = now() where id = _tx_id;
    return 'Todos os times aceitaram. Troca na fila do admin.';
  end if;

  return 'Aceite registrado. Aguardando os demais times.';
end;
$function$;


-- ─── 3) cancelar_troca: proponente desiste (enquanto proposed/accepted) ──────
create or replace function public.cancelar_troca(_tx_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gm     uuid := public.current_gm_id();
  v_prop   uuid;
  v_type   text;
  v_status text;
begin
  select proposed_by, type, status into v_prop, v_type, v_status
  from public.transactions where id = _tx_id;
  if v_status is null then raise exception 'Transação % não encontrada.', _tx_id; end if;
  if v_type <> 'trade' then raise exception 'Transação % não é troca.', _tx_id; end if;
  if v_prop is distinct from v_gm then raise exception 'Só o proponente cancela a troca.'; end if;
  if v_status not in ('proposed','accepted') then
    raise exception 'Troca não pode ser cancelada no status %.', v_status;
  end if;

  update public.transactions set status = 'cancelled', updated_at = now() where id = _tx_id;
  return 'Troca cancelada.';
end;
$function$;


-- ─── 3c) expirar_trocas: varre propostas com prazo vencido -> cancelled ──────
-- Sweep idempotente e inofensivo (só cancela o que já venceu). Sem gate de papel
-- de propósito: serve pra ser chamada por um botão de admin OU por cron/service.
create or replace function public.expirar_trocas()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  update public.transactions
     set status = 'cancelled', updated_at = now(),
         notes  = coalesce(notes || ' | ', '') || 'prazo de aceite expirado (sweep)'
   where type = 'trade' and status = 'proposed'
     and accept_deadline is not null and accept_deadline < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;


-- ─── 4) decidir_transacao: admin aprova/recusa (GENÉRICA, agora type-aware) ──
-- Substitui a versão da fatia 1. Backward-compatible: release/ir/signing seguem
-- exigindo 'proposed'; só a troca exige 'accepted' (todos os times já toparam).
create or replace function public.decidir_transacao(_tx_id uuid, _aceitar boolean, _override boolean default false)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  v_type   text;
  v_req    text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin decide transações.';
  end if;

  select status, type into v_status, v_type from public.transactions where id = _tx_id;
  if v_status is null then
    raise exception 'Transação % não encontrada.', _tx_id;
  end if;

  v_req := case when v_type = 'trade' then 'accepted' else 'proposed' end;
  if v_status <> v_req then
    raise exception 'Transação não está pronta p/ decisão (status %, esperado %).', v_status, v_req;
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


-- ─── 5) executar_troca: aplica (ATÔMICO). tx 'approved' + type 'trade' ───────
create or replace function public.executar_troca(_tx_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tx         record;
  v_season_int integer;
  v_override   boolean;
  v_parties    uuid[];
  v_item       record;
  v_p          record;
  v_bad        record;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin executa.';
  end if;

  select * into v_tx from public.transactions where id = _tx_id;
  if v_tx is null then raise exception 'Transação não encontrada.'; end if;
  if v_tx.type <> 'trade' then raise exception 'Transação não é troca (type=%).', v_tx.type; end if;
  if v_tx.status <> 'approved' then raise exception 'Transação não está aprovada (status=%).', v_tx.status; end if;

  v_override := coalesce(v_tx.admin_override, false);
  select start_year into v_season_int from public.seasons where id = v_tx.season_id;

  select array_agg(distinct tm) into v_parties from (
    select from_team_id tm from public.transaction_items where transaction_id = _tx_id and from_team_id is not null
    union
    select to_team_id     from public.transaction_items where transaction_id = _tx_id and to_team_id   is not null
  ) s;

  -- Bloco atômico: tudo-ou-nada. Qualquer RAISE aqui faz ROLLBACK dos movimentos
  -- (savepoint implícito do EXCEPTION) e a transação vira 'failed' + motivo.
  begin
    for v_item in
      select * from public.transaction_items where transaction_id = _tx_id order by created_at
    loop
      if v_item.asset_type = 'player' then
        update public.roster_entries
           set team_id = v_item.to_team_id, acquired_via = 'trade', updated_at = now()
         where team_id = v_item.from_team_id and player_id = v_item.player_id
           and season = v_season_int and status = 'active';
        if not found then
          raise exception 'Jogador % não está mais ativo no time de origem.', v_item.player_id;
        end if;

      elsif v_item.asset_type = 'pick' then
        update public.draft_picks
           set current_team_id = v_item.to_team_id, updated_at = now()
         where id = v_item.pick_id and current_team_id = v_item.from_team_id
           and is_used = false and disputed = false;
        if not found then
          raise exception 'Pick % indisponível (posse mudou / usada / em disputa).', v_item.pick_id;
        end if;

      elsif v_item.asset_type = 'penalty' then
        select team_id, amount, season_id, origin_team_id into v_p
        from public.team_penalties where id = v_item.source_penalty_id for update;
        if not found then raise exception 'Multa % inexistente.', v_item.source_penalty_id; end if;
        if v_p.team_id is distinct from v_item.from_team_id then
          raise exception 'Multa % não é mais do time de origem.', v_item.source_penalty_id;
        end if;
        if v_p.amount < v_item.amount then
          raise exception 'Saldo da multa % insuficiente (tem %, pediu %).',
            v_item.source_penalty_id, v_p.amount, v_item.amount;
        end if;
        -- reduz a origem (pode chegar a 0 = linha cap-neutra, não deletável por FK)
        update public.team_penalties
           set amount = amount - v_item.amount
         where id = v_item.source_penalty_id;
        -- nasce a fatia no destino (mesma season; origem preservada; source='traded')
        insert into public.team_penalties (team_id, season_id, amount, source, origin_team_id)
        values (v_item.to_team_id, v_p.season_id, v_item.amount, 'traded',
                coalesce(v_p.origin_team_id, v_item.from_team_id));
      end if;
    end loop;

    -- revalidação pós-movimentos (salvo override, que fura cap E vagas)
    if not v_override then
      -- vaga: 15 ativos (IR fora)
      for v_bad in
        select re.team_id, count(*) n
        from public.roster_entries re
        where re.team_id = any(v_parties) and re.season = v_season_int and re.status <> 'injured_reserve'
        group by re.team_id
        having count(*) > 15
      loop
        raise exception 'Time % ficou com % jogadores ativos (máx 15).', v_bad.team_id, v_bad.n;
      end loop;

      -- cap: hard cap 70M, só temporada corrente
      for v_bad in
        select c.team_id, c.available
        from public.team_cap_usage(v_tx.season_id) c
        where c.team_id = any(v_parties) and c.available < 0
      loop
        raise exception 'Time % estourou o teto (cap disponível %).', v_bad.team_id, v_bad.available;
      end loop;
    end if;

  exception
    when others then
      update public.transactions
         set status = 'failed', updated_at = now(),
             notes  = coalesce(notes || ' | ', '') || 'troca falhou no commit: ' || SQLERRM
       where id = _tx_id;
      return 'Falhou: ' || SQLERRM;
  end;

  update public.transactions
     set status = 'executed', executed_at = now(), updated_at = now()
   where id = _tx_id;

  return 'Troca executada.';
end;
$function$;
