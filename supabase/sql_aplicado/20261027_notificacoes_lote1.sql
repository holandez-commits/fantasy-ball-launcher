-- 27/10/2026 — Sino de notificações, LOTE 1: infra + mercado aberto/fechado + prazo de escalação + jogo concluído.
-- Aplicado em PROD via MCP. Reversão no fim do arquivo (comentada).

-- ─── Tabelas ────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  gm_id       uuid not null references public.gms(id) on delete cascade,
  category    text not null check (category in ('mercado','prazo','jogo','troca','movimentacao','leilao','admin')),
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_gm_created_idx on public.notifications (gm_id, created_at desc);
create index if not exists notifications_gm_unread_idx  on public.notifications (gm_id) where read_at is null;
create index if not exists notifications_created_idx    on public.notifications (created_at);
create unique index if not exists notifications_dedupe_uq on public.notifications (gm_id, dedupe_key) where dedupe_key is not null;

create table if not exists public.notification_prefs (
  gm_id    uuid not null references public.gms(id) on delete cascade,
  category text not null check (category in ('mercado','prazo','jogo','troca','movimentacao','leilao','admin')),
  enabled  boolean not null default true,
  primary key (gm_id, category)
);

alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;

-- Leitura só do próprio GM. Escritas só por funções SECURITY DEFINER (sem policy de insert/update/delete).
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (gm_id in (select id from public.gms where user_id = auth.uid()));
drop policy if exists notification_prefs_select_own on public.notification_prefs;
create policy notification_prefs_select_own on public.notification_prefs for select to authenticated
  using (gm_id in (select id from public.gms where user_id = auth.uid()));

-- ─── Núcleo: fan-out (interno — ninguém chama pelo cliente) ──────────────────
-- _gm_ids null = todos os GMs de times ativos. Respeita a preferência "silenciar categoria".
-- Idempotente por (gm, dedupe_key). Limpa o que passou de 60 dias.
create or replace function public.notify_gms(
  _gm_ids uuid[], _category text, _kind text, _title text, _body text, _link text, _dedupe text default null
) returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  insert into public.notifications (gm_id, category, kind, title, body, link, dedupe_key)
  select g.id, _category, _kind, _title, _body, _link, _dedupe
  from public.gms g
  where g.user_id is not null
    and ( (_gm_ids is null and exists (select 1 from public.teams t where t.gm_id = g.id and t.is_active))
          or (_gm_ids is not null and g.id = any(_gm_ids)) )
    and not exists (select 1 from public.notification_prefs p
                    where p.gm_id = g.id and p.category = _category and p.enabled = false)
  on conflict (gm_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  delete from public.notifications where created_at < now() - interval '60 days';
  return n;
end $fn$;
revoke all on function public.notify_gms(uuid[], text, text, text, text, text, text) from public, anon, authenticated;

-- ─── RPCs do cliente ────────────────────────────────────────────────────────
create or replace function public.get_notificacoes(_limit integer default 30, _offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_gm uuid; v_unread integer; v_total integer; v_items jsonb;
begin
  select id into v_gm from public.gms where user_id = auth.uid() limit 1;
  if v_gm is null then
    return jsonb_build_object('unread', 0, 'total', 0, 'items', '[]'::jsonb);
  end if;
  select count(*) filter (where read_at is null), count(*) into v_unread, v_total
    from public.notifications where gm_id = v_gm;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_items
  from (
    select id, category, kind, title, body, link, created_at, read_at
    from public.notifications where gm_id = v_gm
    order by created_at desc, id
    limit least(greatest(coalesce(_limit, 30), 1), 100)
    offset greatest(coalesce(_offset, 0), 0)
  ) x;
  return jsonb_build_object('unread', v_unread, 'total', v_total, 'items', v_items);
end $fn$;

create or replace function public.marcar_notificacao_lida(_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.notifications n set read_at = now()
   where n.id = _id and n.read_at is null
     and n.gm_id in (select id from public.gms where user_id = auth.uid());
end $fn$;

create or replace function public.marcar_todas_notificacoes_lidas() returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  update public.notifications x set read_at = now()
   where x.read_at is null and x.gm_id in (select id from public.gms where user_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $fn$;

create or replace function public.get_notificacao_prefs() returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'enabled', coalesce(p.enabled, true)) order by c.ord), '[]'::jsonb)
  from (values ('mercado',1),('prazo',2),('jogo',3),('troca',4),('movimentacao',5),('leilao',6),('admin',7)) c(category, ord)
  left join public.notification_prefs p
    on p.category = c.category and p.gm_id = (select id from public.gms where user_id = auth.uid() limit 1);
$fn$;

create or replace function public.set_notificacao_pref(_category text, _enabled boolean) returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v_gm uuid;
begin
  select id into v_gm from public.gms where user_id = auth.uid() limit 1;
  if v_gm is null then raise exception 'Você não tem um GM associado.'; end if;
  if _category not in ('mercado','prazo','jogo','troca','movimentacao','leilao','admin') then
    raise exception 'Categoria inválida: %', _category;
  end if;
  insert into public.notification_prefs (gm_id, category, enabled) values (v_gm, _category, coalesce(_enabled, true))
  on conflict (gm_id, category) do update set enabled = excluded.enabled;
end $fn$;

revoke all on function public.get_notificacoes(integer, integer), public.marcar_notificacao_lida(uuid),
  public.marcar_todas_notificacoes_lidas(), public.get_notificacao_prefs(), public.set_notificacao_pref(text, boolean)
  from public, anon;
grant execute on function public.get_notificacoes(integer, integer), public.marcar_notificacao_lida(uuid),
  public.marcar_todas_notificacoes_lidas(), public.get_notificacao_prefs(), public.set_notificacao_pref(text, boolean)
  to authenticated;

-- ─── Eventos do lote 1 ──────────────────────────────────────────────────────
-- 1) Mercado aberto/fechado — gatilho na tabela (pega set_market_open E a reabertura da consolidação).
create or replace function public.trg_notify_market_state() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_cur boolean;
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
  return new;
end $fn$;
drop trigger if exists trg_market_state_notify on public.market_state;
create trigger trg_market_state_notify after insert or update of is_open on public.market_state
  for each row execute function public.trg_notify_market_state();

-- 2) Prazo de escalação definido / alterado.
create or replace function public.trg_notify_roster_lock() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_cur boolean; v_when text;
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
  return new;
end $fn$;
drop trigger if exists trg_roster_locks_notify on public.roster_locks;
create trigger trg_roster_locks_notify after insert or update of locks_at on public.roster_locks
  for each row execute function public.trg_notify_roster_lock();

-- 3) Jogo concluído — avisa os dois GMs do confronto (1 aviso por jogo/time; reabrir+fechar de novo não duplica).
create or replace function public.trg_notify_game_final() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_cur boolean; v_home text; v_away text; v_hgm uuid; v_agm uuid;
  v_hs integer; v_as integer; v_ties integer; v_title text; v_sfx text;
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
  return new;
end $fn$;
drop trigger if exists trg_games_notify_final on public.games;
create trigger trg_games_notify_final after update of status on public.games
  for each row when (new.status = 'final' and old.status is distinct from 'final')
  execute function public.trg_notify_game_final();

-- ─── Reversão (se precisar) ─────────────────────────────────────────────────
-- drop trigger trg_games_notify_final on public.games; drop trigger trg_roster_locks_notify on public.roster_locks;
-- drop trigger trg_market_state_notify on public.market_state;
-- drop function public.trg_notify_game_final(), public.trg_notify_roster_lock(), public.trg_notify_market_state(),
--   public.set_notificacao_pref(text, boolean), public.get_notificacao_prefs(), public.marcar_todas_notificacoes_lidas(),
--   public.marcar_notificacao_lida(uuid), public.get_notificacoes(integer, integer),
--   public.notify_gms(uuid[], text, text, text, text, text, text);
-- drop table public.notification_prefs, public.notifications;
