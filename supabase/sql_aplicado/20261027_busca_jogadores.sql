-- 27/10/2026 — Buscador de jogador (/jogadores). Aplicado em PROD via MCP.
-- norm_busca(text): minúsculas e sem acento (translate; o projeto não tem a extensão unaccent).
-- buscar_jogadores(_q, _limit): todos os termos precisam aparecer no nome (ordem livre); mín. 2 letras; máx. 50 resultados.
--   Devolve jsonb [{player_id, full_name, espn_id, nba_team, team_id, team_name, team_slug, status, ir_type, position, acquired_via, contract[]}].
--   team_* nulos = não está em elenco 26/27 (free agent). Dados já públicos (/elencos, /times); grant p/ anon e authenticated.
-- Reversão: drop function public.buscar_jogadores(text, integer); drop function public.norm_busca(text);

create or replace function public.norm_busca(_t text) returns text
language sql immutable parallel safe set search_path to 'public' as $fn$
  select lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñŠšŽžČčĆćĐđŁłŘřŐőŞşĞğİıŃńŚśŹźŻżŪū',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnSsZzCcCcDdLlRrOoSsGgIiNnSsZzZzUu'))
$fn$;

create or replace function public.buscar_jogadores(_q text, _limit integer default 25)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_start integer; v_label text; v_terms text[]; v_res jsonb; v_q text;
begin
  v_q := public.norm_busca(btrim(coalesce(_q, '')));
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  v_terms := regexp_split_to_array(v_q, '\s+');
  select start_year, label into v_start, v_label from public.seasons where is_current limit 1;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.ord_time, x.ord_prefix, x.full_name), '[]'::jsonb) into v_res
  from (
    select
      p.id as player_id,
      p.full_name,
      p.espn_id,
      p.nba_team,
      t.id as team_id,
      t.name as team_name,
      t.slug as team_slug,
      re.status,
      re.ir_type,
      re.position,
      re.acquired_via,
      coalesce((
        select jsonb_agg(jsonb_build_object('season_label', cy.season_label, 'salary', cy.salary) order by cy.season_label)
        from public.roster_contract_years cy where cy.roster_entry_id = re.id
      ), '[]'::jsonb) as contract,
      case when re.id is null then 1 else 0 end as ord_time,
      case when public.norm_busca(p.full_name) like v_terms[1] || '%'
             or public.norm_busca(p.full_name) like '% ' || v_terms[1] || '%' then 0 else 1 end as ord_prefix
    from public.players p
    left join public.roster_entries re on re.player_id = p.id and re.season = v_start
    left join public.teams t on t.id = re.team_id
    where not exists (
      select 1 from unnest(v_terms) term where public.norm_busca(p.full_name) not like '%' || term || '%'
    )
    order by 13, 14, p.full_name
    limit least(greatest(coalesce(_limit, 25), 1), 50)
  ) x;
  return v_res;
end $fn$;

revoke all on function public.buscar_jogadores(text, integer) from public;
grant execute on function public.buscar_jogadores(text, integer) to anon, authenticated;
