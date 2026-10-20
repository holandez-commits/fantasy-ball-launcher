-- 20261019 — propor_troca / executar_troca: mostram o NOME do time (não o UUID)
-- nas mensagens de erro de cap/vaga. Único ajuste: lookup do nome + v_name nas
-- RAISE (regra de vaga segue estrita, > 15). Rodado via MCP no PROD (sessão 11).
-- (CREATE OR REPLACE mantém a assinatura — não precisa DROP.)

CREATE OR REPLACE FUNCTION public.propor_troca(_itens jsonb, _week integer DEFAULT NULL::integer, _accept_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_name       text;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'A troca precisa de ao menos um item.';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  v_deadline := coalesce(_accept_deadline, now() + interval '7 days');
  if v_deadline <= now() then
    raise exception 'O prazo de aceite tem que ser no futuro.';
  end if;

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

  insert into public.transactions (type, status, season_id, week_number, proposed_by, accept_deadline)
  values ('trade', 'proposed', v_season_id, _week, v_gm, v_deadline)
  returning id into v_tx;

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

  for v_proj in select * from public.troca_projecao(v_tx) loop
    select name into v_name from public.teams where id = v_proj.team_id;
    if v_proj.new_used > 70000000 then
      raise exception 'Troca inviável: % ficaria com cap de % (teto 70M).', v_name, v_proj.new_used;
    end if;
    if v_proj.new_slots > 15 then
      raise exception 'Troca inviável: % ficaria com % jogadores ativos (máx 15).', v_name, v_proj.new_slots;
    end if;
  end loop;

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

CREATE OR REPLACE FUNCTION public.executar_troca(_tx_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx         record;
  v_season_int integer;
  v_override   boolean;
  v_parties    uuid[];
  v_item       record;
  v_p          record;
  v_bad        record;
  v_name       text;
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
        update public.team_penalties
           set amount = amount - v_item.amount
         where id = v_item.source_penalty_id;
        insert into public.team_penalties (team_id, season_id, amount, source, origin_team_id)
        values (v_item.to_team_id, v_p.season_id, v_item.amount, 'traded',
                coalesce(v_p.origin_team_id, v_item.from_team_id));
      end if;
    end loop;

    if not v_override then
      for v_bad in
        select re.team_id, count(*) n
        from public.roster_entries re
        where re.team_id = any(v_parties) and re.season = v_season_int and re.status <> 'injured_reserve'
        group by re.team_id
        having count(*) > 15
      loop
        select name into v_name from public.teams where id = v_bad.team_id;
        raise exception '% ficou com % jogadores ativos (máx 15).', v_name, v_bad.n;
      end loop;

      for v_bad in
        select c.team_id, c.available
        from public.team_cap_usage(v_tx.season_id) c
        where c.team_id = any(v_parties) and c.available < 0
      loop
        select name into v_name from public.teams where id = v_bad.team_id;
        raise exception '% estourou o teto (cap disponível %).', v_name, v_bad.available;
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
