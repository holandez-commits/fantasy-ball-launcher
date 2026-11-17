-- 17/11/2026 (s23, lote C) — pedido de lesionado exige o link da notícia
-- APLICADO EM PROD (wfmvjzwkffetqaqbvlib) via MCP. Idempotente.
-- Front: src/routes/mercado.tsx (campo "Link da notícia") e src/routes/admin.mercado.tsx (link na fila).
-- Atenção: a assinatura de solicitar_ir mudou (4º parâmetro). O front antigo (3 args) passa a falhar
-- com "Informe o link da notícia..." até o novo front ir ao ar.

alter table public.transactions add column if not exists link_noticia text;
alter table public.transactions drop constraint if exists transactions_link_noticia_http;
alter table public.transactions add constraint transactions_link_noticia_http
  check (link_noticia is null or (link_noticia ~* '^https?://' and length(link_noticia) <= 500));
comment on column public.transactions.link_noticia is
  'Link da notícia que comprova a lesão e o período fora (pedido de lesionado, obrigatório desde 17/11/2026).';

-- A assinatura antiga (uuid, integer, text) precisa sair: com o 4º parâmetro com default, as duas
-- ficariam ambíguas para quem chama com 3 argumentos nomeados.
drop function if exists public.solicitar_ir(uuid, integer, text);

create or replace function public.solicitar_ir(
  _player_id uuid,
  _week integer default null,
  _ir_type text default null,
  _link_noticia text default null
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gm         uuid := public.current_gm_id();
  v_team       uuid := public.current_team_id();
  v_season_id  uuid;
  v_season_int integer;
  v_tx         uuid;
  v_re         uuid;
  v_n          integer;
  v_av         bigint;
  v_sal        bigint;
  v_link       text;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  if _ir_type is null or _ir_type not in ('partial', 'out_of_season') then
    raise exception 'Informe o tipo de lesão: parcial (partial) ou fora da temporada (out_of_season).';
  end if;

  v_link := nullif(btrim(_link_noticia), '');
  if v_link is null then
    raise exception 'Informe o link da notícia que confirma a lesão e o período fora.';
  end if;
  if v_link !~* '^https?://[^[:space:]]+\.[^[:space:]]+$' or length(v_link) > 500 then
    raise exception 'O link da notícia é inválido. Cole o endereço completo, começando com http:// ou https://.';
  end if;

  select id, start_year into v_season_id, v_season_int
  from public.seasons where is_current = true;

  select re.id into v_re from public.roster_entries re
  where re.team_id = v_team and re.player_id = _player_id
    and re.season = v_season_int and re.status = 'active';
  if v_re is null then
    raise exception 'Jogador não está ativo no elenco do seu time.';
  end if;

  select count(*)::integer into v_n from public.roster_entries re
   where re.team_id = v_team and re.season = v_season_int and re.status <> 'injured_reserve';
  select c.available into v_av from public.team_cap_usage(v_season_id) c where c.team_id = v_team;
  select cy.salary into v_sal from public.roster_contract_years cy
    join public.seasons s on s.label = cy.season_label and s.id = v_season_id
   where cy.roster_entry_id = v_re;
  v_av := coalesce(v_av, 0) + case when _ir_type = 'out_of_season' then round(coalesce(v_sal, 0) * 0.8)::bigint else 0 end;
  if public.elenco_minimo_viola(v_n - 1, v_av) then
    raise exception 'Lesionado bloqueado: %', public.elenco_minimo_msg('Seu time', v_n - 1, v_av);
  end if;

  insert into public.transactions (type, status, season_id, week_number, proposed_by, ir_type, link_noticia)
  values ('ir', 'proposed', v_season_id, _week, v_gm, _ir_type, v_link)
  returning id into v_tx;

  insert into public.transaction_items (transaction_id, asset_type, player_id, from_team_id)
  values (v_tx, 'player', _player_id, v_team);

  return v_tx;
end;
$function$;

-- A versão anterior estava liberada para PUBLIC/anon; esta só para logados.
revoke all on function public.solicitar_ir(uuid, integer, text, text) from public, anon;
grant execute on function public.solicitar_ir(uuid, integer, text, text) to authenticated, service_role;
