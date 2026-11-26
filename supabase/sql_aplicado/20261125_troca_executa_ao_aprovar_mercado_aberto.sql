-- s25 (25/11/2026): troca aprovada pelo admin com o MERCADO ABERTO é executada na hora.
-- Mercado fechado: continua 'approved' e a consolidação executa na fila FIFO.
-- Só trocas; lesionado (ir) e demais tipos seguem em duas etapas (aprovar + executar).
-- Aplicado em PROD via MCP (migration 20261125_troca_executa_ao_aprovar_mercado_aberto).

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
  v_season uuid;
  v_open   boolean;
  v_exec   text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin decide transações.';
  end if;

  select status, type, season_id into v_status, v_type, v_season
    from public.transactions where id = _tx_id;
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

  if not _aceitar then
    return 'Transação recusada.';
  end if;

  if v_type = 'trade' then
    select is_open into v_open from public.market_state where season_id = v_season;
    if coalesce(v_open, false) then
      begin
        v_exec := public.executar_troca(_tx_id);
      exception when others then
        return 'Transação aprovada, mas a execução automática não rodou: ' || SQLERRM;
      end;
      return 'Transação aprovada. ' || v_exec;
    end if;
    return 'Transação aprovada. Mercado fechado: a consolidação executa.';
  end if;

  return 'Transação aprovada.';
end;
$function$;
