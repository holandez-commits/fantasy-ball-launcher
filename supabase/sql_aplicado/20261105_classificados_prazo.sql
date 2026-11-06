-- 20261105_classificados_prazo.sql
--
-- Prazo (expiração) nos anúncios dos Classificados:
--   * trade_block_posts.expires_at: o anúncio some sozinho depois dessa data.
--   * Prazo escolhido por quem anuncia: padrão 7 dias, máximo 1 mês (igual ao prazo de aceite de troca).
--   * trade_block_limpar apaga anúncios vencidos (já é chamado ao listar e ao publicar).
--   * get_trade_block devolve expires_at; o aviso aos outros GMs cita a validade.
-- Anúncios já existentes ganham 7 dias a partir da aplicação.
-- Reversão: alter table public.trade_block_posts drop column expires_at; e reaplicar as definições
-- anteriores de publicar_trade_block(uuid[], uuid[], text), get_trade_block() e trade_block_limpar().

alter table public.trade_block_posts add column if not exists expires_at timestamptz;
update public.trade_block_posts set expires_at = now() + interval '7 days' where expires_at is null;
alter table public.trade_block_posts alter column expires_at set not null;
alter table public.trade_block_posts alter column expires_at set default (now() + interval '7 days');

create or replace function public.trade_block_limpar()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_start integer; n0 integer; n1 integer; n2 integer; n3 integer;
begin
  select start_year into v_start from public.seasons where is_current limit 1;
  -- anúncios vencidos (os itens saem em cascata)
  delete from public.trade_block_posts where expires_at <= now();
  get diagnostics n0 = row_count;
  delete from public.trade_block_items i using public.trade_block_posts p
   where i.post_id = p.id and i.asset_type = 'player'
     and not exists (select 1 from public.roster_entries re
                      where re.team_id = p.team_id and re.player_id = i.player_id
                        and re.season = v_start and re.status = 'active');
  get diagnostics n1 = row_count;
  delete from public.trade_block_items i using public.trade_block_posts p
   where i.post_id = p.id and i.asset_type = 'pick'
     and not exists (select 1 from public.draft_picks d
                      where d.id = i.pick_id and d.current_team_id = p.team_id
                        and not d.is_used and not d.disputed);
  get diagnostics n2 = row_count;
  delete from public.trade_block_posts p
   where not exists (select 1 from public.trade_block_items i where i.post_id = p.id);
  get diagnostics n3 = row_count;
  return n0 + n1 + n2 + n3;
end $function$;

create or replace function public.get_trade_block()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_label text; v_team uuid := public.current_team_id(); v_res jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para ver o trade block.'; end if;
  perform public.trade_block_limpar();
  select label into v_label from public.seasons where is_current limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'team_id', p.team_id,
    'team_name', t.name,
    'team_slug', t.slug,
    'note', p.note,
    'created_at', p.created_at,
    'expires_at', p.expires_at,
    'mine', (p.team_id = v_team),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_type', i.asset_type,
        'player_id', i.player_id,
        'full_name', pl.full_name,
        'espn_id', pl.espn_id,
        'position', re.position,
        'salary', (select cy.salary from public.roster_contract_years cy
                    where cy.roster_entry_id = re.id and cy.season_label = v_label limit 1),
        'pick_id', i.pick_id,
        'round', d.round,
        'season_label', ds.label,
        'origin', ot.name
      ) order by i.asset_type desc, pl.full_name, ds.label, d.round)
      from public.trade_block_items i
      left join public.players pl on pl.id = i.player_id
      left join public.roster_entries re on re.player_id = i.player_id and re.team_id = p.team_id
        and re.season = (select start_year from public.seasons where is_current limit 1)
      left join public.draft_picks d on d.id = i.pick_id
      left join public.seasons ds on ds.id = d.draft_season_id
      left join public.teams ot on ot.id = d.original_team_id
      where i.post_id = p.id
    ), '[]'::jsonb)
  ) order by p.created_at desc), '[]'::jsonb) into v_res
  from public.trade_block_posts p join public.teams t on t.id = p.team_id;
  return v_res;
end $function$;

-- troca de assinatura: remove a antiga pra não ficar função duplicada
drop function if exists public.publicar_trade_block(uuid[], uuid[], text);

create or replace function public.publicar_trade_block(_players uuid[], _picks uuid[], _note text default null, _expires_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team uuid := public.current_team_id(); v_gm uuid := public.current_gm_id();
  v_start integer; v_np integer; v_nk integer; v_post uuid; v_note text;
  v_tname text; v_desc text; v_gms uuid[]; v_exp timestamptz;
begin
  if v_team is null or v_gm is null then raise exception 'Você não tem um time ativo (não é GM?).'; end if;
  v_np := coalesce(array_length(_players, 1), 0);
  v_nk := coalesce(array_length(_picks, 1), 0);
  if v_np + v_nk = 0 then raise exception 'Escolha pelo menos um jogador ou uma pick.'; end if;
  if v_np + v_nk > 20 then raise exception 'No máximo 20 itens por anúncio.'; end if;
  v_note := nullif(btrim(coalesce(_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then raise exception 'O texto pode ter no máximo 200 caracteres.'; end if;

  -- prazo do anúncio: padrão 7 dias; precisa ser futuro e no máximo 1 mês (folga de 10 min pro relógio do navegador)
  v_exp := coalesce(_expires_at, now() + interval '7 days');
  if v_exp <= now() then raise exception 'O prazo do anúncio precisa ser uma data futura.'; end if;
  if v_exp > now() + interval '1 month' + interval '10 minutes' then
    raise exception 'O prazo do anúncio pode ser de no máximo 1 mês.';
  end if;

  perform public.trade_block_limpar();
  select start_year into v_start from public.seasons where is_current limit 1;

  if v_np > 0 and (select count(distinct x) from unnest(_players) x) <> v_np then raise exception 'Jogador repetido na lista.'; end if;
  if v_nk > 0 and (select count(distinct x) from unnest(_picks) x) <> v_nk then raise exception 'Pick repetida na lista.'; end if;

  if v_np > 0 and (select count(*) from public.roster_entries re
                    where re.team_id = v_team and re.season = v_start and re.status = 'active'
                      and re.player_id = any(_players)) <> v_np then
    raise exception 'Só jogadores ativos do seu elenco podem ser anunciados.';
  end if;
  if v_nk > 0 and (select count(*) from public.draft_picks d
                    where d.current_team_id = v_team and not d.is_used and not d.disputed
                      and d.id = any(_picks)) <> v_nk then
    raise exception 'Só picks suas (não usadas e não em disputa) podem ser anunciadas.';
  end if;
  if v_nk > 0 and exists (select 1 from public.get_picks_proprias_status() s where s.pick_id = any(_picks) and s.locked) then
    raise exception 'Uma das picks está indisponível para troca (regra: nunca 2 anos seguidos sem a própria 1ª).';
  end if;
  if exists (select 1 from public.trade_block_items i where i.player_id = any(_players) or i.pick_id = any(_picks)) then
    raise exception 'Algum item já está em um anúncio ativo. Retire o anúncio anterior primeiro.';
  end if;

  insert into public.trade_block_posts (team_id, gm_id, note, expires_at) values (v_team, v_gm, v_note, v_exp) returning id into v_post;
  insert into public.trade_block_items (post_id, asset_type, player_id)
    select v_post, 'player', x from unnest(_players) x;
  insert into public.trade_block_items (post_id, asset_type, pick_id)
    select v_post, 'pick', x from unnest(_picks) x;

  begin
    select name into v_tname from public.teams where id = v_team;
    select string_agg(s.txt, ', ' order by s.ord, s.txt) into v_desc from (
      select 0 as ord, pl.full_name as txt from public.players pl where pl.id = any(_players)
      union all
      select 1, d.round::text || 'ª ' || coalesce(ds.label, '—') || ' (de ' || coalesce(ot.name, '—') || ')'
        from public.draft_picks d
        left join public.seasons ds on ds.id = d.draft_season_id
        left join public.teams ot on ot.id = d.original_team_id
       where d.id = any(_picks)
    ) s;
    select array_agg(g.id) into v_gms
      from public.gms g
     where g.user_id is not null and g.id <> v_gm
       and exists (select 1 from public.teams t where t.gm_id = g.id and t.is_active);
    perform public.notify_gms(v_gms, 'bloco', 'trade_block_post', coalesce(v_tname, 'Um time') || ' anunciou nos Classificados Bola Presa',
      coalesce(v_desc, '') || coalesce(E'\n“' || v_note || '”', '')
        || E'\nAnúncio válido até ' || to_char(v_exp at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.',
      '/classificados', 'block:' || v_post);
  exception when others then
    null; -- aviso nunca impede de publicar
  end;
  return v_post;
end $function$;

revoke all on function public.publicar_trade_block(uuid[], uuid[], text, timestamptz) from public, anon;
grant execute on function public.publicar_trade_block(uuid[], uuid[], text, timestamptz) to authenticated;
