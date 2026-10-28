-- 27/10/2026 — Sino: blindagem dos gatilhos dos lotes 1 e 2. Aplicado em PROD via MCP.
-- Cada função agora roda o corpo dentro de BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END, então uma falha ao montar/gravar
-- o aviso nunca bloqueia market_state, roster_locks, games, transaction_approvals nem transactions. Lógica inalterada.
-- Testado em rollback: regressão dos avisos + falha injetada (CHECK que sempre falha em notifications) → jogo finaliza, mercado alterna, 0 avisos.
-- Funções: trg_notify_market_state, trg_notify_roster_lock, trg_notify_game_final, trg_notify_approval_insert,
--          trg_notify_approval_answer, trg_notify_tx_status (corpos = lote1/lote2 envoltos no bloco de exceção).
-- Os triggers (CREATE TRIGGER) não mudaram; só CREATE OR REPLACE FUNCTION.

create or replace function public.trg_notify_market_state() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_cur boolean;
begin
  begin
    if TG_OP = 'UPDATE' and old.is_open is not distinct from new.is_open then return new; end if;
    select is_current into v_cur from public.seasons where id = new.season_id;
    if not coalesce(v_cur, false) then return new; end if;
    if new.is_open then
      perform public.notify_gms(null, 'mercado', 'market_opened', 'Mercado aberto',
        'Já dá para propor trocas, dispensas e IR.', '/mercado', null);
    else
      perform public.notify_gms(null, 'mercado', 'market_closed', 'Mercado fechado',
        'Lances de free agent liberados no leilão até a consolidação.', '/leilao', null);
    end if;
  exception when others then
    null;
  end;
  return new;
end $fn$;

create or replace function public.trg_notify_roster_lock() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_cur boolean; v_when text;
begin
  begin
    select is_current into v_cur from public.seasons where id = new.season_id;
    if not coalesce(v_cur, false) then return new; end if;
    if TG_OP = 'UPDATE' and old.locks_at is not distinct from new.locks_at then return new; end if;
    v_when := to_char(new.locks_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');
    if TG_OP = 'INSERT' then
      perform public.notify_gms(null, 'prazo', 'lock_set', 'Prazo de escalação definido — Semana ' || new.week_number,
        'Escale até ' || v_when || ' (horário de Brasília).', '/escalar', null);
    else
      perform public.notify_gms(null, 'prazo', 'lock_changed', 'Prazo de escalação alterado — Semana ' || new.week_number,
        'Novo prazo: ' || v_when || ' (horário de Brasília).', '/escalar', null);
    end if;
  exception when others then
    null;
  end;
  return new;
end $fn$;

create or replace function public.trg_notify_game_final() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_cur boolean; v_home text; v_away text; v_hgm uuid; v_agm uuid;
  v_hs integer; v_as integer; v_ties integer; v_title text; v_sfx text;
begin
  begin
    select is_current into v_cur from public.seasons where id = new.season_id;
    if not coalesce(v_cur, false) then return new; end if;
    select name, gm_id into v_home, v_hgm from public.teams where id = new.home_team_id;
    select name, gm_id into v_away, v_agm from public.teams where id = new.away_team_id;
    v_hs := coalesce(new.home_score, 0); v_as := coalesce(new.away_score, 0); v_ties := coalesce(new.tied_categories, 0);
    v_title := 'Jogo concluído — Semana ' || coalesce(new.week_number::text, '?');
    v_sfx := case when v_ties = 0 then ''
                  when v_ties = 1 then ' (1 categoria empatada)'
                  else ' (' || v_ties || ' categorias empatadas)' end;

    perform public.notify_gms(array[v_hgm], 'jogo', 'game_final', v_title,
      case when v_hs > v_as then 'Vitória sobre ' || v_away || ' por ' || v_hs || ' a ' || v_as
           when v_hs < v_as then 'Derrota para ' || v_away || ' por ' || v_hs || ' a ' || v_as
           else 'Empate com ' || v_away || ': ' || v_hs || ' a ' || v_as end || v_sfx,
      '/confronto/' || new.id, 'game_final:' || new.id || ':' || new.home_team_id);

    perform public.notify_gms(array[v_agm], 'jogo', 'game_final', v_title,
      case when v_as > v_hs then 'Vitória sobre ' || v_home || ' por ' || v_as || ' a ' || v_hs
           when v_as < v_hs then 'Derrota para ' || v_home || ' por ' || v_as || ' a ' || v_hs
           else 'Empate com ' || v_home || ': ' || v_as || ' a ' || v_hs end || v_sfx,
      '/confronto/' || new.id, 'game_final:' || new.id || ':' || new.away_team_id);
  exception when others then
    null;
  end;
  return new;
end $fn$;

create or replace function public.trg_notify_approval_insert() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_type text; v_dl timestamptz; v_prop uuid; v_pname text; v_gm uuid; v_when text;
begin
  begin
    if new.accepted is not null then return new; end if;
    select type, accept_deadline, proposed_by into v_type, v_dl, v_prop from public.transactions where id = new.transaction_id;
    if v_type is distinct from 'trade' then return new; end if;
    select name into v_pname from public.teams where gm_id = v_prop and is_active order by name limit 1;
    select gm_id into v_gm from public.teams where id = new.team_id;
    if v_gm is null then return new; end if;
    v_when := case when v_dl is null then '' else ' Responda até ' || to_char(v_dl at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.' end;
    perform public.notify_gms(array[v_gm], 'troca', 'trade_proposed', 'Proposta de troca recebida',
      coalesce(v_pname, 'Outro time') || ' propôs uma troca com o seu time.' || v_when,
      '/mercado', 'tx:' || new.transaction_id || ':proposta:' || new.team_id);
  exception when others then
    null;
  end;
  return new;
end $fn$;

create or replace function public.trg_notify_approval_answer() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_type text; v_prop uuid; v_tname text; v_pteam uuid;
begin
  begin
    if new.accepted is null or old.accepted is not distinct from new.accepted then return new; end if;
    select type, proposed_by into v_type, v_prop from public.transactions where id = new.transaction_id;
    if v_type is distinct from 'trade' or v_prop is null then return new; end if;
    select id into v_pteam from public.teams where gm_id = v_prop and is_active order by name limit 1;
    if new.team_id = v_pteam then return new; end if;
    select name into v_tname from public.teams where id = new.team_id;
    perform public.notify_gms(array[v_prop], 'troca',
      case when new.accepted then 'trade_accepted_by' else 'trade_refused_by' end,
      case when new.accepted then 'Time aceitou sua proposta' else 'Time recusou sua proposta' end,
      coalesce(v_tname, 'Um time') || case when new.accepted then ' aceitou' else ' recusou' end || ' a troca que você propôs.',
      '/mercado', 'tx:' || new.transaction_id || ':resp:' || new.team_id);
  exception when others then
    null;
  end;
  return new;
end $fn$;

create or replace function public.trg_notify_tx_status() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
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
        if coalesce(new.notes, '') like '%prazo de aceite expirado%' then
          perform public.notify_gms(v_gms, 'troca', 'trade_expired', 'Troca cancelada: prazo de aceite expirou',
            'Nem todos os times responderam a tempo.', '/mercado', 'tx:' || new.id || ':cancelled');
        else
          perform public.notify_gms(array_remove(v_gms, new.proposed_by), 'troca', 'trade_cancelled', 'Troca cancelada pelo proponente',
            'A proposta foi retirada.', '/mercado', 'tx:' || new.id || ':cancelled');
        end if;
      end if;
    elsif new.type in ('release', 'ir') and new.proposed_by is not null
          and new.status in ('approved', 'rejected') and new.admin_decided_at is not null then
      v_label := case when new.type = 'release' then 'Dispensa' else 'IR' end;
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
end $fn$;
