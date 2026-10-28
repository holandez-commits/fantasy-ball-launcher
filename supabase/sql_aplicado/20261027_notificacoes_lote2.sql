-- 27/10/2026 — Sino, LOTE 2: propostas e decisões pessoais (categoria 'troca'). Aplicado em PROD via MCP.
-- Só gatilhos (não altera propor_troca/aceitar_troca/cancelar_troca/decidir_transacao).
-- 1) transaction_approvals INSERT (accepted null)  -> "Proposta de troca recebida" p/ cada time não-proponente
-- 2) transaction_approvals UPDATE accepted         -> proponente: "Time aceitou/recusou sua proposta"
-- 3) transactions UPDATE status (trade): accepted (todos aceitaram) / approved / rejected pelo admin / cancelled (expirada ou pelo proponente) -> times envolvidos
--    transactions UPDATE status (release/ir): approved/rejected pelo admin -> GM proponente
-- Execução (executed) fica no lote 3.
-- Reversão: drop trigger trg_approvals_notify_insert on public.transaction_approvals; drop trigger trg_approvals_notify_answer on public.transaction_approvals;
--   drop trigger trg_transactions_notify_status on public.transactions; drop function public.trg_notify_approval_insert(), public.trg_notify_approval_answer(), public.trg_notify_tx_status();

create or replace function public.trg_notify_approval_insert() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_type text; v_dl timestamptz; v_prop uuid; v_pname text; v_gm uuid; v_when text;
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
  return new;
end $fn$;
drop trigger if exists trg_approvals_notify_insert on public.transaction_approvals;
create trigger trg_approvals_notify_insert after insert on public.transaction_approvals
  for each row execute function public.trg_notify_approval_insert();

create or replace function public.trg_notify_approval_answer() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_type text; v_prop uuid; v_tname text; v_pteam uuid;
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
  return new;
end $fn$;
drop trigger if exists trg_approvals_notify_answer on public.transaction_approvals;
create trigger trg_approvals_notify_answer after update of accepted on public.transaction_approvals
  for each row execute function public.trg_notify_approval_answer();

create or replace function public.trg_notify_tx_status() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_gms uuid[]; v_label text;
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
  return new;
end $fn$;
drop trigger if exists trg_transactions_notify_status on public.transactions;
create trigger trg_transactions_notify_status after update of status on public.transactions
  for each row execute function public.trg_notify_tx_status();
