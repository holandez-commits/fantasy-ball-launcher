-- s25 (25/11/2026): o proponente pode alterar o prazo de aceite da própria troca.
-- Só enquanto a troca está 'proposed' (aguardando aceite); novo prazo tem que ser futuro.
-- Aplicado em PROD via MCP (migration 20261125_alterar_prazo_troca). Testado em rollback.

create or replace function public.alterar_prazo_troca(_tx_id uuid, _novo_prazo timestamptz)
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
  if v_gm is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select proposed_by, type, status into v_prop, v_type, v_status
    from public.transactions where id = _tx_id;
  if v_status is null then raise exception 'Transação % não encontrada.', _tx_id; end if;
  if v_type <> 'trade' then raise exception 'Transação % não é troca.', _tx_id; end if;
  if v_prop is distinct from v_gm then raise exception 'Só o proponente altera o prazo.'; end if;
  if v_status <> 'proposed' then
    raise exception 'O prazo só pode ser alterado enquanto a troca aguarda aceite (status %).', v_status;
  end if;
  if _novo_prazo is null or _novo_prazo <= now() then
    raise exception 'O novo prazo tem que ser no futuro.';
  end if;

  update public.transactions
     set accept_deadline = _novo_prazo, updated_at = now()
   where id = _tx_id;

  return 'Prazo de aceite alterado.';
end;
$function$;

revoke all on function public.alterar_prazo_troca(uuid, timestamptz) from public, anon;
grant execute on function public.alterar_prazo_troca(uuid, timestamptz) to authenticated;
