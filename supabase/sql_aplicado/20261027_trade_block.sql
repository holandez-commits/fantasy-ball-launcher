-- 27/10/2026 — Trade block. Aplicado em PROD via MCP (3 chamadas: DDL; funções; testes em rollback).
-- Tabelas trade_block_posts (1 anúncio de um time, com texto até 200 chars) e trade_block_items (jogadores e/ou picks do anúncio).
-- Índices únicos parciais: um jogador/pick só pode estar em UM anúncio. RLS ligado SEM policies: tudo via RPC SECURITY DEFINER.
-- Retirar = apagar o anúncio (sem histórico). Itens que saem do time (troca, dispensa, IR, pick usada/trocada) são removidos
-- por trade_block_limpar(), chamada em get_trade_block e publicar_trade_block; anúncio sem itens some.
-- Sino: nova categoria 'bloco' (checks de notifications e notification_prefs recriados; prefs/set_pref atualizados).
-- RPCs: get_trade_block(), get_trade_block_ofertaveis(), publicar_trade_block(_players uuid[], _picks uuid[], _note text), retirar_trade_block(_post_id).
-- Reversão: drop function public.publicar_trade_block(uuid[],uuid[],text), public.retirar_trade_block(uuid), public.get_trade_block(), public.get_trade_block_ofertaveis(), public.trade_block_limpar();
--   drop table public.trade_block_items, public.trade_block_posts; (checks de categoria: remover 'bloco' e recriar get_notificacao_prefs/set_notificacao_pref do lote 1)

alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('mercado','prazo','jogo','troca','bloco','movimentacao','leilao','admin'));
alter table public.notification_prefs drop constraint if exists notification_prefs_category_check;
alter table public.notification_prefs add constraint notification_prefs_category_check
  check (category in ('mercado','prazo','jogo','troca','bloco','movimentacao','leilao','admin'));

create table if not exists public.trade_block_posts (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  gm_id      uuid not null references public.gms(id),
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists trade_block_posts_created_idx on public.trade_block_posts (created_at desc);
create index if not exists trade_block_posts_team_idx on public.trade_block_posts (team_id);

create table if not exists public.trade_block_items (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.trade_block_posts(id) on delete cascade,
  asset_type text not null check (asset_type in ('player','pick')),
  player_id  uuid references public.players(id) on delete cascade,
  pick_id    uuid references public.draft_picks(id) on delete cascade,
  check ((asset_type = 'player' and player_id is not null and pick_id is null)
      or (asset_type = 'pick' and pick_id is not null and player_id is null))
);
create index if not exists trade_block_items_post_idx on public.trade_block_items (post_id);
create unique index if not exists trade_block_items_player_uq on public.trade_block_items (player_id) where player_id is not null;
create unique index if not exists trade_block_items_pick_uq on public.trade_block_items (pick_id) where pick_id is not null;

alter table public.trade_block_posts enable row level security;
alter table public.trade_block_items enable row level security;

create or replace function public.trade_block_limpar() returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare v_start integer; n1 integer; n2 integer; n3 integer;
begin
  select start_year into v_start from public.seasons where is_current limit 1;
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
  return n1 + n2 + n3;
end $fn$;
revoke all on function public.trade_block_limpar() from public, anon, authenticated;

create or replace function public.get_trade_block() returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $fn$
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
end $fn$;

create or replace function public.get_trade_block_ofertaveis() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_team uuid := public.current_team_id(); v_start integer; v_label text;
begin
  if v_team is null then raise exception 'Você não tem um time ativo (não é GM?).'; end if;
  select start_year, label into v_start, v_label from public.seasons where is_current limit 1;
  return jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pl.id, 'full_name', pl.full_name, 'espn_id', pl.espn_id, 'position', re.position,
        'salary', (select cy.salary from public.roster_contract_years cy
                    where cy.roster_entry_id = re.id and cy.season_label = v_label limit 1)
      ) order by pl.full_name)
      from public.roster_entries re join public.players pl on pl.id = re.player_id
      where re.team_id = v_team and re.season = v_start and re.status = 'active'
        and not exists (select 1 from public.trade_block_items i where i.player_id = pl.id)
    ), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pick_id', d.id, 'round', d.round, 'season_label', ds.label, 'origin', ot.name
      ) order by ds.label, d.round)
      from public.draft_picks d
      left join public.seasons ds on ds.id = d.draft_season_id
      left join public.teams ot on ot.id = d.original_team_id
      where d.current_team_id = v_team and not d.is_used and not d.disputed
        and not exists (select 1 from public.trade_block_items i where i.pick_id = d.id)
    ), '[]'::jsonb)
  );
end $fn$;

create or replace function public.publicar_trade_block(_players uuid[], _picks uuid[], _note text default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_team uuid := public.current_team_id(); v_gm uuid := public.current_gm_id();
  v_start integer; v_np integer; v_nk integer; v_post uuid; v_note text;
  v_tname text; v_desc text; v_gms uuid[];
begin
  if v_team is null or v_gm is null then raise exception 'Você não tem um time ativo (não é GM?).'; end if;
  v_np := coalesce(array_length(_players, 1), 0);
  v_nk := coalesce(array_length(_picks, 1), 0);
  if v_np + v_nk = 0 then raise exception 'Escolha pelo menos um jogador ou uma pick.'; end if;
  if v_np + v_nk > 20 then raise exception 'No máximo 20 itens por anúncio.'; end if;
  v_note := nullif(btrim(coalesce(_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then raise exception 'O texto pode ter no máximo 200 caracteres.'; end if;

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
  if exists (select 1 from public.trade_block_items i where i.player_id = any(_players) or i.pick_id = any(_picks)) then
    raise exception 'Algum item já está em um anúncio ativo. Retire o anúncio anterior primeiro.';
  end if;

  insert into public.trade_block_posts (team_id, gm_id, note) values (v_team, v_gm, v_note) returning id into v_post;
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
    perform public.notify_gms(v_gms, 'bloco', 'trade_block_post', coalesce(v_tname, 'Um time') || ' abriu o trade block',
      coalesce(v_desc, '') || coalesce(E'\n“' || v_note || '”', ''), '/trade-block', 'block:' || v_post);
  exception when others then
    null; -- aviso nunca impede de publicar
  end;
  return v_post;
end $fn$;

create or replace function public.retirar_trade_block(_post_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v_team uuid := public.current_team_id(); v_owner uuid;
begin
  select team_id into v_owner from public.trade_block_posts where id = _post_id;
  if v_owner is null then return; end if;
  if v_owner is distinct from v_team and not public.has_role('admin') then
    raise exception 'Só o time dono do anúncio (ou um admin) pode retirá-lo.';
  end if;
  delete from public.trade_block_posts where id = _post_id;
end $fn$;

create or replace function public.get_notificacao_prefs() returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'enabled', coalesce(p.enabled, true)) order by c.ord), '[]'::jsonb)
  from (values ('mercado',1),('prazo',2),('jogo',3),('troca',4),('bloco',5),('movimentacao',6),('leilao',7),('admin',8)) c(category, ord)
  left join public.notification_prefs p
    on p.category = c.category and p.gm_id = (select id from public.gms where user_id = auth.uid() limit 1);
$fn$;

create or replace function public.set_notificacao_pref(_category text, _enabled boolean) returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v_gm uuid;
begin
  select id into v_gm from public.gms where user_id = auth.uid() limit 1;
  if v_gm is null then raise exception 'Você não tem um GM associado.'; end if;
  if _category not in ('mercado','prazo','jogo','troca','bloco','movimentacao','leilao','admin') then
    raise exception 'Categoria inválida: %', _category;
  end if;
  insert into public.notification_prefs (gm_id, category, enabled) values (v_gm, _category, coalesce(_enabled, true))
  on conflict (gm_id, category) do update set enabled = excluded.enabled;
end $fn$;

revoke all on function public.get_trade_block(), public.get_trade_block_ofertaveis(),
  public.publicar_trade_block(uuid[], uuid[], text), public.retirar_trade_block(uuid) from public, anon;
grant execute on function public.get_trade_block(), public.get_trade_block_ofertaveis(),
  public.publicar_trade_block(uuid[], uuid[], text), public.retirar_trade_block(uuid) to authenticated;
