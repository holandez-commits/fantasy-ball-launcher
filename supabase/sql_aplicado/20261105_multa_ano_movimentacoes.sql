-- 20261105_multa_ano_movimentacoes.sql
--
-- Multas trocadas passam a informar o ANO (temporada) da multa:
--  1) get_movimentacoes_pagina: cada item ganha 'penalty_season' (label da temporada de
--     team_penalties, via transaction_items.source_penalty_id). Mesma assinatura (CREATE OR REPLACE).
--  2) trg_notify_tx_executed: texto do sino da troca executada vira "multa 26/27 de $500,000".
--  3) propor_troca / executar_troca: mensagens de erro/nota que citavam a multa só pelo uuid
--     passam a citar o ano ("Multa 26/27 ..."). Lógica das funções inalterada.
--  (E-mails de troca/dispensa e a Edge Function enviar-resumo-liga já citam o ano: nada a mudar.)
--
-- Reversão: reaplicar as versões anteriores (20261024_get_movimentacoes_paginado.sql +
-- 20261030_movimentacoes_pos_contrato.sql; e 20261027_notificacoes_lote*.sql).

create or replace function public.get_movimentacoes_pagina(
  _season_id uuid default null,
  _month text default null,
  _team_id uuid default null,
  _limit integer default 30,
  _offset integer default 0
)
returns table(id uuid, type text, status text, processed_at timestamptz, week_number integer, ir_type text, items jsonb, total_count bigint)
language sql stable security definer set search_path to 'public' as $function$
  with p as (
    select
      case when _month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           then make_timestamptz(split_part(_month, '-', 1)::int,
                                 split_part(_month, '-', 2)::int,
                                 1, 0, 0, 0, 'America/Sao_Paulo')
      end as m_start
  ),
  r as (
    select m_start,
           ((m_start at time zone 'America/Sao_Paulo') + interval '1 month')
             at time zone 'America/Sao_Paulo' as m_end
    from p
  ),
  f as (
    select
      t.id,
      t.type,
      t.status,
      coalesce(t.executed_at, t.admin_decided_at, t.updated_at) as processed_at,
      t.week_number,
      t.ir_type,
      t.season_id,
      t.email_snapshot as snap,
      count(*) over () as total_count
    from public.transactions t, r
    where t.status = 'executed'
      and (_season_id is null or t.season_id = _season_id)
      and (r.m_start is null or (
            coalesce(t.executed_at, t.admin_decided_at, t.updated_at) >= r.m_start
        and coalesce(t.executed_at, t.admin_decided_at, t.updated_at) <  r.m_end))
      and (_team_id is null or exists (
            select 1 from public.transaction_items x
            where x.transaction_id = t.id
              and (x.from_team_id = _team_id or x.to_team_id = _team_id)))
    order by coalesce(t.executed_at, t.admin_decided_at, t.updated_at) desc, t.id desc
    limit least(greatest(coalesce(_limit, 30), 1), 100)
    offset greatest(coalesce(_offset, 0), 0)
  )
  select
    f.id,
    f.type,
    f.status,
    f.processed_at,
    f.week_number,
    f.ir_type,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_type', ti.asset_type,
        'player', pl.full_name,
        'from', ft.name,
        'to', tt.name,
        'amount', ti.amount,
        'pick', case when ti.pick_id is not null
                     then (dp.round::text || 'ª · ' || coalesce(ds.label, '—') || ' · de ' || coalesce(ot.name, '—'))
                     else null end,
        'pos', coalesce(re.position, f.snap->>'pos', wr.position),
        'salary', coalesce(c.sal, nullif(f.snap->>'salary', '')::bigint),
        'years', coalesce(nullif(c.yrs, 0), nullif(f.snap->>'years', '')::int),
        'penalty_season', ps.label
      ))
      from public.transaction_items ti
      left join public.players pl on pl.id = ti.player_id
      left join public.teams ft on ft.id = ti.from_team_id
      left join public.teams tt on tt.id = ti.to_team_id
      left join public.draft_picks dp on dp.id = ti.pick_id
      left join public.seasons ds on ds.id = dp.draft_season_id
      left join public.teams ot on ot.id = dp.original_team_id
      left join public.team_penalties tp on tp.id = ti.source_penalty_id
      left join public.seasons ps on ps.id = tp.season_id
      left join public.seasons ss on ss.id = f.season_id
      left join lateral (
        select r2.id, r2.position from public.roster_entries r2
         where r2.player_id = ti.player_id and r2.season = ss.start_year
         order by (r2.team_id = coalesce(ti.to_team_id, ti.from_team_id)) desc
         limit 1) re on true
      left join lateral (
        select max(cy.salary) filter (where cy.season_label = ss.label) as sal,
               count(*) filter (where cy.season_label >= ss.label) as yrs
          from public.roster_contract_years cy where cy.roster_entry_id = re.id) c on true
      left join lateral (
        select w.position from public.weekly_rosters w
         where w.player_id = ti.player_id and w.position is not null
         order by w.created_at desc limit 1) wr on true
      where ti.transaction_id = f.id
    ), '[]'::jsonb) as items,
    f.total_count
  from f
  order by f.processed_at desc, f.id desc;
$function$;

create or replace function public.trg_notify_tx_executed()
returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cur boolean; v_player text; v_team text; v_body text; v_ir text;
begin
  begin
    if TG_OP <> 'UPDATE' or new.status is distinct from 'executed' or old.status is not distinct from 'executed' then
      return new;
    end if;
    select is_current into v_cur from public.seasons where id = new.season_id;
    if not coalesce(v_cur, false) then return new; end if;

    if new.type = 'trade' then
      select string_agg(x.linha, E'\n' order by x.team_name) into v_body
      from (
        select tt.name as team_name,
               tt.name || ' recebe: ' || string_agg(
                 case ti.asset_type
                   when 'player' then pl.full_name
                   when 'pick' then dp.round::text || 'ª ' || coalesce(ds.label, '—') || ' (de ' || coalesce(ot.name, '—') || ')'
                   when 'penalty' then 'multa ' || coalesce(ps.label || ' ', '') || 'de $' || to_char(ti.amount, 'FM999,999,999')
                 end, ', ' order by ti.asset_type, pl.full_name) as linha
        from public.transaction_items ti
        join public.teams tt on tt.id = ti.to_team_id
        left join public.players pl on pl.id = ti.player_id
        left join public.draft_picks dp on dp.id = ti.pick_id
        left join public.seasons ds on ds.id = dp.draft_season_id
        left join public.teams ot on ot.id = dp.original_team_id
        left join public.team_penalties tp on tp.id = ti.source_penalty_id
        left join public.seasons ps on ps.id = tp.season_id
        where ti.transaction_id = new.id
        group by tt.name
      ) x;
      perform public.notify_gms(null, 'movimentacao', 'trade_executed', 'Troca executada',
        coalesce(v_body, 'Troca consolidada.'), '/movimentacoes', 'mov:' || new.id);

    elsif new.type = 'release' then
      select pl.full_name, t.name into v_player, v_team
        from public.transaction_items ti
        join public.players pl on pl.id = ti.player_id
        left join public.teams t on t.id = ti.from_team_id
       where ti.transaction_id = new.id and ti.asset_type = 'player' limit 1;
      perform public.notify_gms(null, 'movimentacao', 'release_executed', 'Dispensa executada',
        coalesce(v_team, 'Um time') || ' dispensou ' || coalesce(v_player, 'um jogador') || '.',
        '/movimentacoes', 'mov:' || new.id);

    elsif new.type = 'ir' then
      select pl.full_name, t.name into v_player, v_team
        from public.transaction_items ti
        join public.players pl on pl.id = ti.player_id
        left join public.teams t on t.id = ti.from_team_id
       where ti.transaction_id = new.id and ti.asset_type = 'player' limit 1;
      v_ir := case new.ir_type when 'partial' then ' (IR parcial)' when 'out_of_season' then ' (IR fora da temporada)' else '' end;
      perform public.notify_gms(null, 'movimentacao', 'ir_executed', 'Jogador no IR',
        coalesce(v_team, 'Um time') || ' colocou ' || coalesce(v_player, 'um jogador') || ' no IR' || v_ir || '.',
        '/movimentacoes', 'mov:' || new.id);
    end if;
  exception when others then
    null; -- aviso nunca pode derrubar a consolidação
  end;
  return new;
end $function$;

-- ───────────────────────── 3) propor_troca ─────────────────────────
create or replace function public.propor_troca(_itens jsonb, _week integer default null, _accept_deadline timestamptz default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $function$
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
  v_plabel     text;
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
      if v_amt is null or v_amt <= 0 then raise exception 'Valor de multa inválido.'; end if;
      select tp.team_id, s.label into v_penteam, v_plabel
        from public.team_penalties tp left join public.seasons s on s.id = tp.season_id
       where tp.id = v_sid;
      if not found then raise exception 'Multa % inexistente.', v_sid; end if;
      if v_penteam is distinct from v_from then
        raise exception 'Multa % não pertence ao time de origem.', coalesce(v_plabel, '—');
      end if;

    else
      raise exception 'asset_type inválido: %', v_at;
    end if;
  end loop;

  perform public.validar_picks_proprias_troca(_itens);

  for v_chk in
    select it.fr, it.tt, it.sid, sum(it.amt) tot,
           (select s.label from public.seasons s where s.id = it.sid) lbl
    from (
      select (e->>'from_team_id')::uuid fr, (e->>'to_team_id')::uuid tt,
             (select tp.season_id from public.team_penalties tp where tp.id = (e->>'source_penalty_id')::uuid) sid,
             (e->>'amount')::bigint amt
      from jsonb_array_elements(_itens) e
      where e->>'asset_type' = 'penalty'
    ) it
    group by it.fr, it.tt, it.sid
    having sum(it.amt) < 50000
  loop
    raise exception 'Multa % enviada por ano precisa ser de no mínimo 50.000 (enviado: %).', coalesce(v_chk.lbl, '—'), v_chk.tot;
  end loop;

  for v_chk in
    select (e->>'source_penalty_id')::uuid src, sum((e->>'amount')::bigint) req
    from jsonb_array_elements(_itens) e
    where e->>'asset_type' = 'penalty'
    group by 1
  loop
    select tp.amount, s.label into v_penamt, v_plabel
      from public.team_penalties tp left join public.seasons s on s.id = tp.season_id
     where tp.id = v_chk.src;
    if v_chk.req > v_penamt then
      raise exception 'Soma das fatias (%) excede o saldo da multa % (%).', v_chk.req, coalesce(v_plabel, '—'), v_penamt;
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

-- ───────────────────────── 3) executar_troca ─────────────────────────
create or replace function public.executar_troca(_tx_id uuid)
returns text
language plpgsql security definer set search_path to 'public' as $function$
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
    perform public.validar_picks_proprias_troca_tx(_tx_id);
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
        select team_id, amount, season_id, origin_team_id,
               (select s.label from public.seasons s where s.id = team_penalties.season_id) as lbl
          into v_p
        from public.team_penalties where id = v_item.source_penalty_id for update;
        if not found then raise exception 'Multa % inexistente.', v_item.source_penalty_id; end if;
        if v_p.team_id is distinct from v_item.from_team_id then
          raise exception 'Multa % não é mais do time de origem.', coalesce(v_p.lbl, '—');
        end if;
        if v_p.amount < v_item.amount then
          raise exception 'Saldo da multa % insuficiente (tem %, pediu %).',
            coalesce(v_p.lbl, '—'), v_p.amount, v_item.amount;
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
