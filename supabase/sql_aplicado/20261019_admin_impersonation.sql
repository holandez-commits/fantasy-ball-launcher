-- 20261019_admin_impersonation.sql
-- Aplicado em 19/out/2026 (via MCP, PROD).
--
-- TEMPORÁRIO (testes finais): deixa os admins "agirem como" qualquer time.
-- Tudo passa por current_team_id()/current_gm_id() — ensinando essas 2 funções a
-- respeitar uma linha em admin_impersonation, o site inteiro (RLS, mercado, escalação)
-- passa a enxergar o admin como o time escolhido, sem tocar nas dezenas de funções do motor.
--
-- Frontend: seletor em src/components/ImpersonationSwitcher.tsx (só admin) +
-- banner no topo (__root.tsx). Chama impersonate_team()/stop_impersonating().
--
-- >>> COMO REVERTER QUANDO OS TESTES ACABAREM (ver bloco no fim do arquivo). <<<

create table if not exists public.admin_impersonation (
  admin_user_id uuid primary key references auth.users(id) on delete cascade,
  acting_team_id uuid references public.teams(id) on delete set null,  -- NULL = nao impersonando
  updated_at timestamptz not null default now()
);

alter table public.admin_impersonation enable row level security;

do $pol$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='admin_impersonation'
      and policyname='admin_imp_select_own'
  ) then
    create policy admin_imp_select_own on public.admin_impersonation
      for select to authenticated
      using (admin_user_id = auth.uid() and public.has_role('admin'));
  end if;
end;
$pol$;

create or replace function public.impersonate_team(_team_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not public.has_role('admin') then
    raise exception 'apenas admin pode impersonar';
  end if;
  if not exists (select 1 from public.teams where id = _team_id) then
    raise exception 'time inexistente';
  end if;
  insert into public.admin_impersonation(admin_user_id, acting_team_id, updated_at)
  values (auth.uid(), _team_id, now())
  on conflict (admin_user_id)
    do update set acting_team_id = excluded.acting_team_id, updated_at = now();
end;
$fn$;

create or replace function public.stop_impersonating()
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.admin_impersonation
     set acting_team_id = null, updated_at = now()
   where admin_user_id = auth.uid();
end;
$fn$;

create or replace function public.current_impersonation()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select ai.acting_team_id
    from public.admin_impersonation ai
   where ai.admin_user_id = auth.uid()
     and public.has_role('admin');
$fn$;

grant execute on function public.impersonate_team(uuid) to authenticated;
grant execute on function public.stop_impersonating() to authenticated;
grant execute on function public.current_impersonation() to authenticated;

-- Helpers impersonation-aware (comportamento original quando acting_team_id IS NULL)
create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(
    (select ai.acting_team_id
       from public.admin_impersonation ai
      where ai.admin_user_id = auth.uid()
        and ai.acting_team_id is not null
        and public.has_role('admin')),
    (select t.id
       from public.teams t
       join public.gms g on g.id = t.gm_id
      where g.user_id = auth.uid()
        and t.is_active = true
      limit 1)
  );
$fn$;

create or replace function public.current_gm_id()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(
    (select t.gm_id
       from public.admin_impersonation ai
       join public.teams t on t.id = ai.acting_team_id
      where ai.admin_user_id = auth.uid()
        and ai.acting_team_id is not null
        and public.has_role('admin')),
    (select id from public.gms where user_id = auth.uid() limit 1)
  );
$fn$;

-- ============================================================================
-- REVERSÃO (rodar quando acabarem os testes) — restaura o comportamento original
-- das 2 funções e descarta a feature de impersonação.
-- ============================================================================
-- create or replace function public.current_team_id()
-- returns uuid language sql stable security definer set search_path to 'public' as $fn$
--   select t.id
--     from public.teams t
--     join public.gms g on g.id = t.gm_id
--    where g.user_id = auth.uid()
--      and t.is_active = true
--    limit 1;
-- $fn$;
--
-- create or replace function public.current_gm_id()
-- returns uuid language sql stable security definer set search_path to 'public' as $fn$
--   select id from public.gms where user_id = auth.uid() limit 1;
-- $fn$;
--
-- drop function if exists public.impersonate_team(uuid);
-- drop function if exists public.stop_impersonating();
-- drop function if exists public.current_impersonation();
-- drop table if exists public.admin_impersonation;
--
-- E no frontend: apagar src/components/ImpersonationSwitcher.tsx, remover a
-- referência no AppSidebar.tsx e no __root.tsx, e reverter os campos extras em auth.tsx.
