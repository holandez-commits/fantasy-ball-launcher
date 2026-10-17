-- ============================================================================
-- MOTOR DO MERCADO — Fatia 3/leilão (UI): RLS dos lances + definir posição
-- Complementa motor_fatia3_leilao.sql. Entra com as telas do leilão.
--   (a) SELECT em free_agent_bids: leilão SELADO — GM vê só os PRÓPRIOS lances;
--       admin vê todos. (As escritas são por dar_lance/retirar_lance SECURITY DEFINER.)
--   (b) RPC set_signing_position: signings do leilão nascem com position = NULL;
--       o admin define a posição depois (senão o jogador não é escalável nos slots
--       posicionais; o 6H aceita qualquer um).
-- Idempotente. Rodar no STAGING.
-- ============================================================================

-- ─── free_agent_bids: GM vê só os próprios lances; admin vê tudo ────────────
alter table public.free_agent_bids enable row level security;
drop policy if exists "FA bids visible to admin or own team" on public.free_agent_bids;
create policy "FA bids visible to admin or own team"
  on public.free_agent_bids for select
  to authenticated
  using (public.has_role('admin') or team_id = public.current_team_id());

-- ─── set_signing_position: admin define a posição de um vínculo ─────────────
create or replace function public.set_signing_position(_roster_entry_id uuid, _position text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin define a posição de uma contratação.';
  end if;
  if _position is null or btrim(_position) = '' then
    raise exception 'Posição vazia.';
  end if;

  update public.roster_entries
     set position = _position, updated_at = now()
   where id = _roster_entry_id;
  if not found then
    raise exception 'Vínculo % não encontrado.', _roster_entry_id;
  end if;

  return 'Posição definida.';
end;
$function$;
