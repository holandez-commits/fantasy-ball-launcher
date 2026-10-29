-- s19: fechamento automático do mercado (sábado 00:00 BRT = 03:00 UTC). Já aplicado em PROD via MCP.
create extension if not exists pg_cron;
create table if not exists public.market_automation (
  id boolean primary key default true check (id),
  auto_close_enabled boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now(),
  last_run_at timestamptz, last_run_result text);
alter table public.market_automation enable row level security;
insert into public.market_automation (id) values (true) on conflict (id) do nothing;
-- funções: market_auto_close_run() (interna, sem grant), get_market_auto_close(), set_market_auto_close(bool) (admin)
-- job: select cron.schedule('market-auto-close', '0 3 * * 6', $$select public.market_auto_close_run()$$);
-- pausar via SQL: select cron.unschedule('market-auto-close');  (ou usar o botão em /admin/mercado)
