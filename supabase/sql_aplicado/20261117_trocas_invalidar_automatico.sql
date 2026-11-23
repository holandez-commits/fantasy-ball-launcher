-- 17/11/2026 (s23, lote C) — troca pendente é cancelada sozinha quando deixa de ser possível
-- APLICADO EM PROD (wfmvjzwkffetqaqbvlib) via MCP. Idempotente (create or replace; cron.schedule por nome).
--
-- Antes: nada cancelava uma troca (proposed/accepted) quando um jogador dela era dispensado, trocado ou
-- mandado para lesionados; o erro só aparecia na execução (tx 'failed'). expirar_trocas() existia mas
-- não estava agendada.
--
-- Agora:
--  * trocas_motivo_invalido(tx): null = válida; senão o motivo (jogador fora do time de origem, pick que
--    mudou de dono/usada/em disputa, multa sem saldo).
--  * trocas_invalidar(player, pick, penalty): cancela as trocas abertas que contêm o item e ficaram
--    inválidas (sem argumentos: varre todas). notes = 'cancelada automaticamente: <motivo>'.
--  * Gatilhos AFTER (blindados com EXCEPTION WHEN OTHERS) em roster_entries (team_id/status/delete),
--    draft_picks (current_team_id/is_used/disputed/delete) e team_penalties (team_id/amount/delete).
--  * trg_notify_tx_status: novo ramo 'trade_invalidated' (avisa todos os envolvidos, inclusive o
--    proponente, com o motivo). Os demais ramos ficaram iguais.
--  * pg_cron 'expirar-trocas' a cada 5 min -> expirar_trocas() (prazo de aceite).
--
-- Não coberto de propósito: teto, máximo de 15, mínimo de 12 e Regra 1 (dependem do conjunto da troca;
-- continuam sendo checados na execução). Trocas 'approved' também não entram (a execução marca 'failed').
-- Testado em rollback: lesionado, dispensa (delete), prazo vencido, pick em disputa, multa sem saldo; as
-- trocas abertas válidas não foram tocadas.

create or replace function public.trocas_motivo_invalido(_tx uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $f$
declare
  v_season int;
  v_it     record;
  v_nome   text;
  v_time   text;
begin
  select s.start_year into v_season
  from public.transactions t join public.seasons s on s.id = t.season_id
  where t.id = _tx;

  for v_it in
    select * from public.transaction_items where transaction_id = _tx order by created_at
  loop
    if v_it.from_team_id is null then
      continue;
    end if;
    select name into v_time from public.teams where id = v_it.from_team_id;

    if v_it.asset_type = 'player' then
      if not exists (
        select 1 from public.roster_entries re
        where re.player_id = v_it.player_id and re.team_id = v_it.from_team_id
          and re.season = v_season and re.status = 'active'
      ) then
        select full_name into v_nome from public.players where id = v_it.player_id;
        return coalesce(v_nome, 'Um jogador') || ' não está mais ativo em ' || coalesce(v_time, 'seu time de origem') || '.';
      end if;

    elsif v_it.asset_type = 'pick' then
      if not exists (
        select 1 from public.draft_picks dp
        where dp.id = v_it.pick_id and dp.current_team_id = v_it.from_team_id
          and dp.is_used = false and dp.disputed = false
      ) then
        return 'Uma pick de ' || coalesce(v_time, 'um dos times') || ' não está mais disponível (mudou de dono, foi usada ou está em disputa).';
      end if;

    elsif v_it.asset_type = 'penalty' then
      if not exists (
        select 1 from public.team_penalties tp
        where tp.id = v_it.source_penalty_id and tp.team_id = v_it.from_team_id
          and tp.amount >= coalesce(v_it.amount, 0)
      ) then
        return 'A multa de ' || coalesce(v_time, 'um dos times') || ' não tem mais saldo suficiente para esta troca.';
      end if;
    end if;
  end loop;

  return null;
end
$f$;

create or replace function public.trocas_invalidar(
  _player uuid default null,
  _pick   uuid default null,
  _pen    uuid default null
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_tx record;
  v_m  text;
  v_n  integer := 0;
begin
  for v_tx in
    select distinct t.id
    from public.transactions t
    where t.type = 'trade' and t.status in ('proposed', 'accepted')
      and (
        (_player is null and _pick is null and _pen is null)
        or exists (
          select 1 from public.transaction_items ti
          where ti.transaction_id = t.id
            and ((_player is not null and ti.player_id = _player)
              or (_pick   is not null and ti.pick_id = _pick)
              or (_pen    is not null and ti.source_penalty_id = _pen))
        )
      )
  loop
    v_m := public.trocas_motivo_invalido(v_tx.id);
    if v_m is not null then
      update public.transactions
         set status = 'cancelled', updated_at = now(),
             notes  = coalesce(notes || ' | ', '') || 'cancelada automaticamente: ' || v_m
       where id = v_tx.id and status in ('proposed', 'accepted');
      if found then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end
$f$;

revoke all on function public.trocas_motivo_invalido(uuid) from public, anon, authenticated;
revoke all on function public.trocas_invalidar(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.trg_trocas_invalidar_roster() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.trocas_invalidar(old.player_id, null, null);
    elsif old.team_id is distinct from new.team_id or old.status is distinct from new.status then
      perform public.trocas_invalidar(old.player_id, null, null);
    end if;
  exception when others then null;
  end;
  return null;
end
$f$;

create or replace function public.trg_trocas_invalidar_pick() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.trocas_invalidar(null, old.id, null);
    else
      perform public.trocas_invalidar(null, new.id, null);
    end if;
  exception when others then null;
  end;
  return null;
end
$f$;

create or replace function public.trg_trocas_invalidar_penalty() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.trocas_invalidar(null, null, old.id);
    else
      perform public.trocas_invalidar(null, null, new.id);
    end if;
  exception when others then null;
  end;
  return null;
end
$f$;

create or replace trigger trg_roster_trocas_invalidar
  after update of team_id, status or delete on public.roster_entries
  for each row execute function public.trg_trocas_invalidar_roster();

create or replace trigger trg_picks_trocas_invalidar
  after update of current_team_id, is_used, disputed or delete on public.draft_picks
  for each row execute function public.trg_trocas_invalidar_pick();

create or replace trigger trg_penalties_trocas_invalidar
  after update of team_id, amount or delete on public.team_penalties
  for each row execute function public.trg_trocas_invalidar_penalty();

create or replace function public.trg_notify_tx_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_gms uuid[]; v_label text;
begin
  begin
    if old.status is not distinct from new.status then return new; end if;
    if new.type = 'trade' then
      select array_agg(distinct t.gm_id) into v_gms
        from public.transaction_approvals a join public.teams t on t.id = a.team_id
       where a.transaction_id = new.id and t.gm_id is not null;
      if v_gms is null then return new; end if;
      if new.status = 'accepted' then
        perform public.notify_gms(v_gms, 'troca', 'trade_all_accepted', 'Troca aceita por todos os times',
          'Aguardando a decisão do admin.', '/mercado', 'tx:' || new.id || ':accepted');
      elsif new.status = 'approved' then
        perform public.notify_gms(v_gms, 'troca', 'trade_approved', 'Troca aprovada pelo admin',
          'Será executada na próxima consolidação.', '/mercado', 'tx:' || new.id || ':approved');
      elsif new.status = 'rejected' and new.admin_decided_at is not null then
        perform public.notify_gms(v_gms, 'troca', 'trade_rejected_admin', 'Troca recusada pelo admin',
          'A troca não será executada.', '/mercado', 'tx:' || new.id || ':rejected_admin');
      elsif new.status = 'cancelled' then
        if coalesce(new.notes, '') like '%cancelada automaticamente:%' then
          perform public.notify_gms(v_gms, 'troca', 'trade_invalidated', 'Troca cancelada: deixou de ser possível',
            coalesce(substring(new.notes from 'cancelada automaticamente: (.*)$'), 'Um item da troca não está mais disponível.'),
            '/mercado', 'tx:' || new.id || ':cancelled');
        elsif coalesce(new.notes, '') like '%prazo de aceite expirado%' then
          perform public.notify_gms(v_gms, 'troca', 'trade_expired', 'Troca cancelada: prazo de aceite expirou',
            'Nem todos os times responderam a tempo.', '/mercado', 'tx:' || new.id || ':cancelled');
        else
          perform public.notify_gms(array_remove(v_gms, new.proposed_by), 'troca', 'trade_cancelled', 'Troca cancelada pelo proponente',
            'A proposta foi retirada.', '/mercado', 'tx:' || new.id || ':cancelled');
        end if;
      end if;
    elsif new.type in ('release', 'ir') and new.proposed_by is not null
          and new.status in ('approved', 'rejected') and new.admin_decided_at is not null then
      v_label := case when new.type = 'release' then 'Dispensa' else 'Lista de lesionados' end;
      perform public.notify_gms(array[new.proposed_by], 'troca',
        case when new.status = 'approved' then new.type || '_approved' else new.type || '_rejected' end,
        v_label || case when new.status = 'approved' then ' aprovada pelo admin' else ' recusada pelo admin' end,
        case when new.status = 'approved' then 'Será executada na próxima consolidação.' else 'A solicitação não será executada.' end,
        '/mercado', 'tx:' || new.id || ':' || new.status);
    end if;
  exception when others then
    null;
  end;
  return new;
end $f$;

select cron.schedule('expirar-trocas', '*/5 * * * *', 'select public.expirar_trocas()');
