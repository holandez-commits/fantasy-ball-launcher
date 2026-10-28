-- 27/10/2026 — Sino, LOTE 3: movimentações da liga ao executar (categorias 'movimentacao' e 'leilao'). Aplicado em PROD via MCP.
-- Só gatilhos; motor (executar_troca/dispensa/ir, leilao_commit) intacto. Cada corpo tem EXCEPTION WHEN OTHERS → aviso nunca derruba a consolidação.
--  transactions UPDATE status→'executed': trade / release / ir  -> todos os GMs ativos (dedupe mov:<tx>)
--  transaction_items INSERT (player de tx 'signing')           -> todos: "X contratou Y por $N"
--  free_agent_bids UPDATE status→'lost'                        -> só o GM do lance: "Lance não venceu"
-- Reversão: drop trigger trg_transactions_notify_executed on public.transactions; drop trigger trg_items_notify_signing on public.transaction_items;
--   drop trigger trg_bids_notify_lost on public.free_agent_bids; drop function public.trg_notify_tx_executed(), public.trg_notify_signing_item(), public.trg_notify_bid_lost();

create or replace function public.trg_notify_tx_executed() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
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
                   when 'penalty' then 'multa de $' || to_char(ti.amount, 'FM999,999,999')
                 end, ', ' order by ti.asset_type, pl.full_name) as linha
        from public.transaction_items ti
        join public.teams tt on tt.id = ti.to_team_id
        left join public.players pl on pl.id = ti.player_id
        left join public.draft_picks dp on dp.id = ti.pick_id
        left join public.seasons ds on ds.id = dp.draft_season_id
        left join public.teams ot on ot.id = dp.original_team_id
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
end $fn$;
drop trigger if exists trg_transactions_notify_executed on public.transactions;
create trigger trg_transactions_notify_executed after update of status on public.transactions
  for each row execute function public.trg_notify_tx_executed();

create or replace function public.trg_notify_signing_item() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_type text; v_season uuid; v_cur boolean; v_player text; v_team text;
begin
  begin
    if new.asset_type <> 'player' or new.to_team_id is null then return new; end if;
    select type, season_id into v_type, v_season from public.transactions where id = new.transaction_id;
    if v_type is distinct from 'signing' then return new; end if;
    select is_current into v_cur from public.seasons where id = v_season;
    if not coalesce(v_cur, false) then return new; end if;
    select full_name into v_player from public.players where id = new.player_id;
    select name into v_team from public.teams where id = new.to_team_id;
    perform public.notify_gms(null, 'leilao', 'signing', 'Contratação no leilão',
      coalesce(v_team, 'Um time') || ' contratou ' || coalesce(v_player, 'um jogador') ||
      ' por $' || to_char(coalesce(new.amount, 0), 'FM999,999,999') || '.',
      '/movimentacoes', 'mov:' || new.transaction_id);
  exception when others then
    null;
  end;
  return new;
end $fn$;
drop trigger if exists trg_items_notify_signing on public.transaction_items;
create trigger trg_items_notify_signing after insert on public.transaction_items
  for each row execute function public.trg_notify_signing_item();

create or replace function public.trg_notify_bid_lost() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_player text; v_gm uuid;
begin
  begin
    if new.status is distinct from 'lost' or old.status is not distinct from 'lost' then return new; end if;
    select full_name into v_player from public.players where id = new.player_id;
    v_gm := coalesce(new.gm_id, (select gm_id from public.teams where id = new.team_id));
    if v_gm is null then return new; end if;
    perform public.notify_gms(array[v_gm], 'leilao', 'bid_lost', 'Lance não venceu',
      'Seu lance de $' || to_char(new.salary_offer, 'FM999,999,999') || ' por ' || coalesce(v_player, 'um jogador') ||
      ' não foi o vencedor.', '/leilao', 'bid:' || new.id);
  exception when others then
    null;
  end;
  return new;
end $fn$;
drop trigger if exists trg_bids_notify_lost on public.free_agent_bids;
create trigger trg_bids_notify_lost after update of status on public.free_agent_bids
  for each row execute function public.trg_notify_bid_lost();
