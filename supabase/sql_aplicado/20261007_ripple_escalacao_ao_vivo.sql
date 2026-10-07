-- ============================================================================
-- Ripple "validar ao vivo" — escalação valida contra roster_entries (elenco ao
-- vivo) em vez de weekly_rosters (foto). Pré-requisito do mercado.
-- Rodar no SQL Editor (Supabase). Aditivo/seguro: nada em produção usa estas
-- funções ainda (telas de admin vivem na branch feature/auth-escalacao, não no ar;
-- não há jogo scheduled). Depois de rodar, arquivar em supabase/sql_aplicado/.
--
-- DECISÕES embutidas (me avise se quiser mudar):
--  (a) market_state NÃO é tocado aqui (é peça do motor; provavelmente sem linha
--      ainda). fechar_semana só tira a foto. Ligar o is_open=false entra no motor.
--  (b) HARDENING: o trigger agora recusa jogador em injured_reserve (regra da liga
--      "IR não é escalável"). Antes só a UI bloqueava; agora o banco também.
--      Se preferir manter o comportamento antigo (IR passava no trigger), remova a
--      linha `and re.status is distinct from 'injured_reserve'`.
--  (c) fechar_semana muda de assinatura (4 args -> 3, sem _locks_at) e consolidar_lock
--      é renomeada. As telas de admin na branch feature/auth-escalacao chamam os nomes/
--      assinaturas antigos -> precisam ser atualizadas ANTES de usar/mergear a branch.
-- ============================================================================


-- ─── 1) TRIGGER: posse agora é o elenco AO VIVO (roster_entries) ─────────────
-- Muda só a fonte de posse (passo 2) + traz o start_year da temporada do jogo.
-- Prazo (1) e posição (3) idênticos. A trigger trg_validate_lineup_slot continua
-- apontando pra esta função (CREATE OR REPLACE mantém o wiring).

CREATE OR REPLACE FUNCTION public.validate_lineup_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id      uuid;
  v_season_id    uuid;
  v_season_int   integer;
  v_week         integer;
  v_is_playoff   boolean;
  v_locks_at     timestamptz;
  v_pos_code     text;
  v_accepts_any  boolean;
  v_roster_pos   text;
  v_is_admin     boolean;
begin
  v_is_admin := public.has_role('admin');

  -- dados da escalação e do jogo (uma busca só) + ano inteiro (start_year) da temporada
  select ml.team_id, g.season_id, s.start_year, g.week_number, g.is_playoff
    into v_team_id, v_season_id, v_season_int, v_week, v_is_playoff
  from public.matchup_lineups ml
  join public.games g   on g.id = ml.game_id
  join public.seasons s on s.id = g.season_id
  where ml.id = new.lineup_id;

  -- só temporada regular por enquanto
  if v_week is null or v_is_playoff then
    raise exception 'Escalação indisponível para jogos de playoff (sem week_number).';
  end if;

  -- (1) PRAZO — checa o lock da semana
  select rl.locks_at into v_locks_at
  from public.roster_locks rl
  where rl.season_id = v_season_id
    and rl.week_number = v_week;

  if v_locks_at is null then
    raise exception 'Semana % ainda não foi aberta (sem roster_lock). Trave a escalação da semana antes de escalar.', v_week;
  end if;

  if now() >= v_locks_at and not v_is_admin then
    raise exception 'Prazo de escalação encerrado para esta semana.';
  end if;

  -- código e regra da posição do slot
  select p.code, p.accepts_any into v_pos_code, v_accepts_any
  from public.positions p
  where p.id = new.position_id;

  -- (2) POSSE — jogador tem que estar no elenco AO VIVO (roster_entries) do time,
  -- na temporada do jogo. IR não é escalável. (era: weekly_rosters / foto)
  select re.position into v_roster_pos
  from public.roster_entries re
  where re.season    = v_season_int
    and re.team_id   = v_team_id
    and re.player_id = new.player_id
    and re.status is distinct from 'injured_reserve'
    and re.position is not null;

  if v_roster_pos is null then
    raise exception 'Jogador não está no elenco ativo deste time (não pode ser escalado).';
  end if;

  -- (3) POSIÇÃO — Sexto Homem aceita qualquer um; senão a posição do slot
  -- tem que estar entre as posições do jogador (split do 'PG/SG').
  if not v_accepts_any then
    if not (v_pos_code = any (string_to_array(v_roster_pos, '/'))) then
      raise exception 'Jogador (%) não joga na posição % do slot.', v_roster_pos, v_pos_code;
    end if;
  end if;

  return new;
end;
$function$;


-- ─── 2) NOVA: fechar_escalacao_semanal — SEGUNDA (só o lock, sem foto) ───────
-- Metade "lock" do antigo fechar_semana.

CREATE OR REPLACE FUNCTION public.fechar_escalacao_semanal(_season_id uuid, _week integer, _locks_at timestamptz)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin pode travar a escalação da semana.';
  end if;

  -- cria/atualiza o lock da semana com o prazo (NÃO tira foto)
  insert into public.roster_locks (season_id, week_number, locks_at, closed_by)
  values (_season_id, _week, _locks_at, auth.uid())
  on conflict (season_id, week_number)
  do update set locks_at  = excluded.locks_at,
                closed_at = now(),
                closed_by = auth.uid();

  return format('Escalação da semana %s travada: prazo em %s (horário de Brasília).',
                _week,
                to_char(_locks_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
end;
$function$;


-- ─── 3) fechar_semana — QUARTA (só a foto). Dropa a assinatura antiga (4 args) ─
-- Metade "foto" do antigo fechar_semana. Sem _locks_at (o lock virou a função acima).

DROP FUNCTION IF EXISTS public.fechar_semana(uuid, integer, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.fechar_semana(_season_id uuid, _week integer, _season_int integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin pode fechar a semana.';
  end if;

  -- refaz o retrato (foto) desta semana a partir do elenco atual (idempotente)
  delete from public.weekly_rosters
   where season_id = _season_id and week_number = _week;

  insert into public.weekly_rosters (season_id, week_number, team_id, player_id, position, status)
  select _season_id, _week, re.team_id, re.player_id, re.position, re.status
  from public.roster_entries re
  where re.season = _season_int
    and re.position is not null;

  get diagnostics v_count = row_count;

  return format('Semana %s fechada: %s jogadores no retrato (foto do elenco).', _week, v_count);
end;
$function$;


-- ─── 4) consolidar_escalacoes_pendentes — renomeia consolidar_lock ───────────
-- Corpo IDÊNTICO ao consolidar_lock (só nome + comentários). Valida ao vivo de
-- graça: insere slots e deixa o trigger (agora roster_entries) decidir buraco.

DROP FUNCTION IF EXISTS public.consolidar_lock(uuid, integer);

CREATE OR REPLACE FUNCTION public.consolidar_escalacoes_pendentes(_season_id uuid, _week integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_game        record;
  v_src_lineup  uuid;
  v_new_lineup  uuid;
  v_slot        record;
  v_copiados    integer := 0;
  v_buracos     integer := 0;
  v_criadas     integer := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin pode consolidar as escalações.';
  end if;

  -- guarda: só consolida depois do prazo da semana (evita atropelar GMs)
  if not exists (
    select 1 from public.roster_locks rl
    where rl.season_id = _season_id and rl.week_number = _week
      and now() >= rl.locks_at
  ) then
    raise exception 'Consolidação só é permitida após o prazo (locks_at) da semana %.', _week;
  end if;

  -- para cada confronto (game+team) desta semana SEM escalação:
  for v_game in
    select g.id as game_id, g.played_on, t.team_id
    from public.games g
    cross join lateral (
      values (g.home_team_id), (g.away_team_id)
    ) as t(team_id)
    where g.season_id = _season_id
      and g.week_number = _week
      and g.is_playoff = false
      and not exists (
        select 1 from public.matchup_lineups ml
        where ml.game_id = g.id and ml.team_id = t.team_id
      )
  loop
    -- acha a última escalação do time (jogo mais recente com escalação)
    select ml.id into v_src_lineup
    from public.matchup_lineups ml
    join public.games g on g.id = ml.game_id
    where ml.team_id = v_game.team_id
      and g.is_playoff = false
    order by g.played_on desc nulls last, g.week_number desc, g.game_number_in_week desc
    limit 1;

    -- sem escalação anterior nenhuma -> deixa vazio (nem cria cabeçalho)
    if v_src_lineup is null then
      continue;
    end if;

    -- cria a escalação nova para este confronto
    insert into public.matchup_lineups (game_id, team_id)
    values (v_game.game_id, v_game.team_id)
    returning id into v_new_lineup;
    v_criadas := v_criadas + 1;

    -- copia cada slot da escalação-molde, revalidando contra o ELENCO AO VIVO.
    -- Slot cujo jogador saiu do elenco (ou está em IR / posição não bate) vira
    -- BURACO (não insere). O trigger levanta exceção; capturamos por slot.
    for v_slot in
      select position_id, slot_type, player_id
      from public.lineup_slots
      where lineup_id = v_src_lineup
    loop
      begin
        -- admin executando: trigger permite mesmo após o prazo
        insert into public.lineup_slots (lineup_id, position_id, slot_type, player_id)
        values (v_new_lineup, v_slot.position_id, v_slot.slot_type, v_slot.player_id);
        v_copiados := v_copiados + 1;
      exception when others then
        -- jogador fora do elenco ao vivo / posição não bate -> buraco
        v_buracos := v_buracos + 1;
      end;
    end loop;
  end loop;

  return format('Consolidado: %s escalações criadas por cópia, %s slots copiados, %s buracos.',
                v_criadas, v_copiados, v_buracos);
end;
$function$;
