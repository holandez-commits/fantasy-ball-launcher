-- Define games.external_url em lote (link da planilha + gid da aba de cada confronto).
-- Admin-only. Por padrão só preenche links vazios; _overwrite = true troca os existentes.
create or replace function public.definir_links_jogos(_items jsonb, _overwrite boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_it      jsonb;
  v_id      uuid;
  v_url     text;
  v_ok      integer := 0;
  v_skip    integer := 0;
  v_bad     integer := 0;
  v_rows    integer;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin define os links dos jogos.';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' then
    raise exception 'Formato inválido: esperado uma lista de {game_id, url}.';
  end if;

  for v_it in select * from jsonb_array_elements(_items) loop
    v_id  := nullif(v_it->>'game_id', '')::uuid;
    v_url := v_it->>'url';
    if v_id is null or v_url is null
       or v_url !~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]+/edit#gid=[0-9]+$' then
      v_bad := v_bad + 1;
      continue;
    end if;

    update public.games
       set external_url = v_url
     where id = v_id
       and (external_url is null or (_overwrite and external_url is distinct from v_url));
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_ok := v_ok + 1; else v_skip := v_skip + 1; end if;
  end loop;

  return format('%s link(s) gravado(s), %s ignorado(s) (já tinham link), %s inválido(s).', v_ok, v_skip, v_bad);
end;
$$;

revoke all on function public.definir_links_jogos(jsonb, boolean) from public, anon;
grant execute on function public.definir_links_jogos(jsonb, boolean) to authenticated;
