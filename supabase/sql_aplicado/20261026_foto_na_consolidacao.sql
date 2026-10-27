-- 26/10/2026 — Etapa 3 (motor): a foto passa a ser tirada NA CONSOLIDAÇÃO e o pool de free agents usa o
-- elenco AO VIVO. Aplicado em PROD via MCP. Reversão: reaplicar as definições anteriores (git/ESTADO).
--
-- 0) transaction_items_check1 exigia amount >= 250.000 em itens de multa (travava trocas de 50k).
--    Vira "amount > 0"; o mínimo real (50.000 por origem/destino/ano) é checado em propor_troca.
--    executar_dispensa NÃO muda (continua gravando item de ledger só a partir de 250k).
alter table public.transaction_items drop constraint transaction_items_check1,
  add constraint transaction_items_check1 check (asset_type <> 'penalty' or amount > 0);

-- 1) dar_lance: pool = quem NÃO está em nenhum elenco da temporada (ao vivo). Não exige mais foto.
do $mig$
declare d text;
begin
  select replace(pg_get_functiondef(p.oid), E'\r', '') into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='dar_lance';
  if position($a$  -- pool = foto de quarta: a foto da semana tem que existir, e o jogador não pode estar nela
  if not exists (select 1 from public.weekly_rosters
                 where season_id = v_season_id and week_number = _week) then
    raise exception 'A foto da semana % ainda não foi tirada (fechar_semana); pool de FA indefinido.', _week;
  end if;
  if exists (select 1 from public.weekly_rosters
             where season_id = v_season_id and week_number = _week and player_id = _player_id) then
    raise exception 'Jogador está em elenco nesta semana (não é free agent).';
  end if;$a$ in d) = 0 then raise exception 'padrao dar_lance nao encontrado'; end if;
  d := replace(d, $a$  -- pool = foto de quarta: a foto da semana tem que existir, e o jogador não pode estar nela
  if not exists (select 1 from public.weekly_rosters
                 where season_id = v_season_id and week_number = _week) then
    raise exception 'A foto da semana % ainda não foi tirada (fechar_semana); pool de FA indefinido.', _week;
  end if;
  if exists (select 1 from public.weekly_rosters
             where season_id = v_season_id and week_number = _week and player_id = _player_id) then
    raise exception 'Jogador está em elenco nesta semana (não é free agent).';
  end if;$a$, $b$  -- pool = free agents AO VIVO: o jogador não pode estar em nenhum elenco da temporada
  -- (elenco só muda na consolidação, então ao vivo == o que a foto mostraria)
  if exists (select 1 from public.roster_entries re
             join public.seasons s on s.start_year = re.season
             where s.id = v_season_id and re.player_id = _player_id) then
    raise exception 'Jogador está em elenco nesta temporada (não é free agent).';
  end if;$b$);
  execute d;
end $mig$;

-- 2) leilao_resolver: elegibilidade do lance = jogador fora de qualquer elenco (ao vivo), não fora da foto.
do $mig$
declare d text;
begin
  select replace(pg_get_functiondef(p.oid), E'\r', '') into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='leilao_resolver';
  if position($a$      and b.player_id not in (select wr.player_id from public.weekly_rosters wr
                               where wr.season_id = _season_id and wr.week_number = _week);$a$ in d) = 0
    then raise exception 'padrao leilao_resolver nao encontrado'; end if;
  d := replace(d, $a$      and b.player_id not in (select wr.player_id from public.weekly_rosters wr
                               where wr.season_id = _season_id and wr.week_number = _week);$a$,
$b$      and b.player_id not in (select re0.player_id from public.roster_entries re0
                               where re0.season = v_start_year);$b$);
  execute d;
end $mig$;

-- 3) consolidar_mercado_commit: tira a foto da semana (elenco pós-fila e pós-leilão) antes de reabrir o mercado.
do $mig$
declare d text;
begin
  select replace(pg_get_functiondef(p.oid), E'\r', '') into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='consolidar_mercado_commit';
  if position($a$  -- Fase 4 — reabre o mercado$a$ in d) = 0 then raise exception 'padrao fase4 nao encontrado'; end if;
  if position($a$  return format('Consolidação concluída: %s da fila processada(s); %s; mercado reaberto.',
                v_fila, v_leilao);$a$ in d) = 0 then raise exception 'padrao return nao encontrado'; end if;
  d := replace(d, $a$  -- Fase 4 — reabre o mercado$a$, $b$  -- Fase 3b — foto do elenco já consolidado (retrato da semana)
  v_foto := public.fechar_semana(v_season, _week, (select start_year from public.seasons where id = v_season));

  -- Fase 4 — reabre o mercado$b$);
  d := replace(d, $a$  return format('Consolidação concluída: %s da fila processada(s); %s; mercado reaberto.',
                v_fila, v_leilao);$a$, $b$  return format('Consolidação concluída: %s da fila processada(s); %s; %s; mercado reaberto.',
                v_fila, v_leilao, v_foto);$b$);
  d := replace(d, $a$  v_leilao  text;$a$, $b$  v_leilao  text;
  v_foto    text;$b$);
  execute d;
end $mig$;
