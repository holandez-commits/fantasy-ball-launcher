--
-- PostgreSQL database dump
--

\restrict 160c3rgsZIMAznnVE2dEnddzerhmrc5M9Ez3mEOdd5oQ6mdGJ7zTlcuoRCRbg6e

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- CREATE SCHEMA public;  -- staging ja tem o schema public


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

-- COMMENT ON SCHEMA public IS 'standard public schema';  -- evita erro de owner


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'editor',
    'viewer',
    'gm'
);


--
-- Name: consolidar_escalacoes_pendentes(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consolidar_escalacoes_pendentes(_season_id uuid, _week integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: current_gm_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_gm_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from public.gms where user_id = auth.uid() limit 1;
$$;


--
-- Name: current_team_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_team_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select t.id
  from public.teams t
  join public.gms g on g.id = t.gm_id
  where g.user_id = auth.uid()
    and t.is_active = true
  limit 1;
$$;


--
-- Name: fechar_escalacao_semanal(uuid, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fechar_escalacao_semanal(_season_id uuid, _week integer, _locks_at timestamp with time zone) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fechar_semana(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fechar_semana(_season_id uuid, _week integer, _season_int integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: get_standings(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_standings(season_ids uuid[]) RETURNS TABLE(team_id uuid, w bigint, d bigint, l bigint, gp bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id AS team_id,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id AND g.home_score > g.away_score) OR (g.away_team_id = t.id AND g.away_score > g.home_score)) AS w,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id OR g.away_team_id = t.id) AND g.home_score = g.away_score) AS d,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id AND g.home_score < g.away_score) OR (g.away_team_id = t.id AND g.away_score < g.home_score)) AS l,
    COUNT(*) FILTER (WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS gp
  FROM teams t
  JOIN games g ON (g.home_team_id = t.id OR g.away_team_id = t.id)
  WHERE g.season_id = ANY(season_ids)
    AND g.is_playoff = false
  GROUP BY t.id;
END;
$$;


--
-- Name: get_weeks_index(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_weeks_index() RETURNS TABLE(season_id uuid, week_number integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT g.season_id, g.week_number
  FROM games g
  WHERE g.is_playoff = false
    AND g.week_number IS NOT NULL
  ORDER BY g.season_id, g.week_number;
END;
$$;


--
-- Name: has_role(public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = _role
  );
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: team_cap_usage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_cap_usage(_season_id uuid) RETURNS TABLE(team_id uuid, salaries bigint, penalties bigint, used bigint, available bigint)
    LANGUAGE sql STABLE
    AS $$
  with s as (
    select start_year as yr, label as season_label
    from seasons
    where id = _season_id
  ),
  sal as (
    select re.team_id, coalesce(sum(cy.salary),0)::bigint as salaries
    from roster_entries re
    join roster_contract_years cy
      on cy.roster_entry_id = re.id
     and cy.season_label = (select season_label from s)   -- << usa seasons.label ('26/27')
    where re.season = (select yr from s)
      and re.status <> 'injured_reserve'
    group by re.team_id
  ),
  pen as (
    select tp.team_id, coalesce(sum(tp.amount),0)::bigint as penalties
    from team_penalties tp
    where tp.season_id = _season_id
    group by tp.team_id
  )
  select t.id,
         coalesce(sal.salaries,0)::bigint,
         coalesce(pen.penalties,0)::bigint,
         (coalesce(sal.salaries,0) + coalesce(pen.penalties,0))::bigint,
         (70000000 - coalesce(sal.salaries,0) - coalesce(pen.penalties,0))::bigint
  from teams t
  left join sal on sal.team_id = t.id
  left join pen on pen.team_id = t.id
  where t.is_active;
$$;


--
-- Name: team_game_stats_totals(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_game_stats_totals(season_ids uuid[]) RETURNS TABLE(game_id uuid, team_id uuid, team_name text, season_id uuid, season_label text, week_number integer, opp_name text, pts numeric, reb numeric, ast numeric, stl numeric, blk numeric, three_pm numeric, turnovers numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.id                          AS game_id,
    pgs.team_id                   AS team_id,
    t.name                        AS team_name,
    g.season_id                   AS season_id,
    s.label                       AS season_label,
    g.week_number                 AS week_number,
    opp.name                      AS opp_name,
    SUM(pgs.pts)::NUMERIC         AS pts,
    SUM(pgs.reb)::NUMERIC         AS reb,
    SUM(pgs.ast)::NUMERIC         AS ast,
    SUM(pgs.stl)::NUMERIC         AS stl,
    SUM(pgs.blk)::NUMERIC         AS blk,
    SUM(pgs.three_pm)::NUMERIC    AS three_pm,
    SUM(pgs.turnovers)::NUMERIC   AS turnovers
  FROM player_game_stats pgs
  JOIN games g   ON g.id  = pgs.game_id
  JOIN teams t   ON t.id  = pgs.team_id
  JOIN seasons s ON s.id  = g.season_id
  JOIN teams opp ON opp.id = CASE
    WHEN g.home_team_id = pgs.team_id THEN g.away_team_id
    ELSE g.home_team_id
  END
  WHERE g.season_id = ANY(season_ids)
    AND g.is_playoff = false
  GROUP BY g.id, pgs.team_id, t.name, g.season_id, s.label, g.week_number, opp.name;
END;
$$;


--
-- Name: team_season_standings(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_season_standings(season_ids uuid[]) RETURNS TABLE(team_id uuid, team_name text, season_id uuid, season_label text, w bigint, d bigint, l bigint, gp bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id                                                                          AS team_id,
    t.name                                                                        AS team_name,
    g.season_id                                                                   AS season_id,
    s.label                                                                       AS season_label,
    COUNT(*) FILTER (WHERE
      (g.home_team_id = t.id AND g.home_score > g.away_score) OR
      (g.away_team_id = t.id AND g.away_score > g.home_score))                   AS w,
    COUNT(*) FILTER (WHERE
      (g.home_team_id = t.id OR g.away_team_id = t.id) AND
      g.home_score = g.away_score)                                                AS d,
    COUNT(*) FILTER (WHERE
      (g.home_team_id = t.id AND g.home_score < g.away_score) OR
      (g.away_team_id = t.id AND g.away_score < g.home_score))                   AS l,
    COUNT(*) FILTER (WHERE
      g.home_team_id = t.id OR g.away_team_id = t.id)                            AS gp
  FROM teams t
  JOIN games g ON (g.home_team_id = t.id OR g.away_team_id = t.id)
  JOIN seasons s ON s.id = g.season_id
  WHERE g.season_id = ANY(season_ids)
    AND g.is_playoff = false
  GROUP BY t.id, t.name, g.season_id, s.label;
END;
$$;


--
-- Name: validate_lineup_slot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_lineup_slot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    key text NOT NULL,
    display_name text NOT NULL,
    display_order integer NOT NULL,
    lower_is_better boolean DEFAULT false NOT NULL
);


--
-- Name: draft_picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_picks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    draft_season_id uuid NOT NULL,
    round integer NOT NULL,
    original_team_id uuid NOT NULL,
    current_team_id uuid NOT NULL,
    disputed boolean DEFAULT false NOT NULL,
    pick_number integer,
    is_used boolean DEFAULT false NOT NULL,
    player_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT draft_picks_round_check CHECK ((round = ANY (ARRAY[1, 2])))
);


--
-- Name: free_agent_bids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.free_agent_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    week_number integer NOT NULL,
    player_id uuid NOT NULL,
    team_id uuid NOT NULL,
    gm_id uuid,
    salary_offer bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT free_agent_bids_salary_offer_check CHECK ((salary_offer >= 750000)),
    CONSTRAINT free_agent_bids_status_check CHECK ((status = ANY (ARRAY['active'::text, 'won'::text, 'lost'::text, 'invalid'::text, 'withdrawn'::text])))
);


--
-- Name: game_category_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_category_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    team_id uuid NOT NULL,
    category_key text NOT NULL,
    value numeric NOT NULL,
    won_category boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    week_number integer,
    home_team_id uuid NOT NULL,
    away_team_id uuid NOT NULL,
    home_score integer DEFAULT 0,
    away_score integer DEFAULT 0,
    tied_categories integer DEFAULT 0,
    game_number_in_week integer DEFAULT 1 NOT NULL,
    game_code text,
    source_post_url text,
    source_sheet_url text,
    source_sheet_tab text,
    played_on date,
    is_playoff boolean DEFAULT false NOT NULL,
    playoff_round text,
    playoff_series_id uuid,
    game_number_in_series integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'final'::text NOT NULL,
    CONSTRAINT games_game_number_in_series_check CHECK (((game_number_in_series >= 1) AND (game_number_in_series <= 5))),
    CONSTRAINT games_playoff_round_check CHECK ((playoff_round = ANY (ARRAY['first_round'::text, 'conference_semis'::text, 'conference_final'::text, 'finals'::text]))),
    CONSTRAINT games_regular_has_week CHECK ((((is_playoff = false) AND (week_number IS NOT NULL) AND (playoff_series_id IS NULL)) OR ((is_playoff = true) AND (playoff_series_id IS NOT NULL) AND (game_number_in_series IS NOT NULL)))),
    CONSTRAINT games_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'final'::text]))),
    CONSTRAINT games_tied_categories_check CHECK (((tied_categories >= 0) AND (tied_categories <= 7)))
);


--
-- Name: gms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    nickname text,
    bio text,
    avatar_url text,
    joined_year integer,
    email text,
    whatsapp text,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lineup_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineup_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lineup_id uuid NOT NULL,
    position_id uuid NOT NULL,
    slot_type text NOT NULL,
    player_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lineup_slots_slot_type_check CHECK ((slot_type = ANY (ARRAY['titular'::text, 'reserva'::text])))
);


--
-- Name: market_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_state (
    season_id uuid NOT NULL,
    is_open boolean DEFAULT false NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by uuid
);


--
-- Name: matchup_lineups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matchup_lineups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: player_game_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_game_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    team_id uuid NOT NULL,
    player_id uuid NOT NULL,
    pts numeric DEFAULT 0 NOT NULL,
    reb numeric DEFAULT 0 NOT NULL,
    ast numeric DEFAULT 0 NOT NULL,
    stl numeric DEFAULT 0 NOT NULL,
    blk numeric DEFAULT 0 NOT NULL,
    three_pm numeric DEFAULT 0 NOT NULL,
    turnovers numeric DEFAULT 0 NOT NULL,
    lineup_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    nba_team text,
    positions text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: playoff_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playoff_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    round text NOT NULL,
    conference text,
    higher_seed_team_id uuid NOT NULL,
    higher_seed_position integer,
    lower_seed_team_id uuid NOT NULL,
    lower_seed_position integer,
    winner_team_id uuid,
    higher_seed_wins integer DEFAULT 0 NOT NULL,
    lower_seed_wins integer DEFAULT 0 NOT NULL,
    series_ties integer DEFAULT 0 NOT NULL,
    tiebreak_used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT playoff_series_conference_check CHECK ((conference = ANY (ARRAY['Donut'::text, 'Bad Boys'::text]))),
    CONSTRAINT playoff_series_conference_consistency CHECK ((((round = ANY (ARRAY['first_round'::text, 'conference_semis'::text, 'conference_final'::text])) AND (conference IS NOT NULL)) OR ((round = 'finals'::text) AND (conference IS NULL)))),
    CONSTRAINT playoff_series_higher_seed_position_check CHECK (((higher_seed_position >= 1) AND (higher_seed_position <= 8))),
    CONSTRAINT playoff_series_lower_seed_position_check CHECK (((lower_seed_position >= 1) AND (lower_seed_position <= 8))),
    CONSTRAINT playoff_series_round_check CHECK ((round = ANY (ARRAY['first_round'::text, 'conference_semis'::text, 'conference_final'::text, 'finals'::text])))
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    accepts_any boolean DEFAULT false NOT NULL
);


--
-- Name: roster_contract_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_contract_years (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_entry_id uuid NOT NULL,
    season_label text NOT NULL,
    salary bigint NOT NULL
);


--
-- Name: roster_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    player_id uuid NOT NULL,
    season integer NOT NULL,
    slot text DEFAULT 'bench'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    acquired_via text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" text,
    ir_since_season integer
);


--
-- Name: roster_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_locks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    week_number integer NOT NULL,
    locks_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid
);


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    start_year integer NOT NULL,
    end_year integer NOT NULL,
    total_weeks integer DEFAULT 17 NOT NULL,
    playoff_start_week integer,
    is_current boolean DEFAULT false NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_name_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_name_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    name text NOT NULL,
    from_season_id uuid,
    to_season_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_penalties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    amount bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    origin_team_id uuid,
    source text,
    CONSTRAINT team_penalties_source_check CHECK ((source = ANY (ARRAY['release'::text, 'manual'::text, 'traded'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    abbreviation text NOT NULL,
    slug text NOT NULL,
    city text,
    conference text,
    primary_color text,
    secondary_color text,
    logo_url text,
    founded_year integer,
    gm_id uuid NOT NULL,
    first_season_id uuid,
    last_season_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teams_conference_check CHECK ((conference = ANY (ARRAY['Donut'::text, 'Bad Boys'::text])))
);


--
-- Name: transaction_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    team_id uuid NOT NULL,
    gm_id uuid,
    accepted boolean,
    decided_at timestamp with time zone
);


--
-- Name: transaction_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    asset_type text NOT NULL,
    player_id uuid,
    pick_id uuid,
    source_penalty_id uuid,
    from_team_id uuid,
    to_team_id uuid,
    amount bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transaction_items_asset_type_check CHECK ((asset_type = ANY (ARRAY['player'::text, 'pick'::text, 'penalty'::text]))),
    CONSTRAINT transaction_items_check CHECK ((((asset_type = 'player'::text) AND (player_id IS NOT NULL) AND (pick_id IS NULL) AND (source_penalty_id IS NULL)) OR ((asset_type = 'pick'::text) AND (pick_id IS NOT NULL) AND (player_id IS NULL) AND (source_penalty_id IS NULL)) OR ((asset_type = 'penalty'::text) AND (source_penalty_id IS NOT NULL) AND (player_id IS NULL) AND (pick_id IS NULL)))),
    CONSTRAINT transaction_items_check1 CHECK (((asset_type <> 'penalty'::text) OR (amount >= 250000)))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    season_id uuid NOT NULL,
    week_number integer,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_by uuid,
    admin_decided_by uuid,
    admin_decided_at timestamp with time zone,
    admin_override boolean DEFAULT false NOT NULL,
    executed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'executed'::text, 'failed'::text]))),
    CONSTRAINT transactions_type_check CHECK ((type = ANY (ARRAY['trade'::text, 'release'::text, 'signing'::text, 'ir'::text])))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: weekly_rosters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_rosters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    week_number integer NOT NULL,
    team_id uuid NOT NULL,
    player_id uuid NOT NULL,
    "position" text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (key);


--
-- Name: draft_picks draft_picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_picks
    ADD CONSTRAINT draft_picks_pkey PRIMARY KEY (id);


--
-- Name: free_agent_bids free_agent_bids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_pkey PRIMARY KEY (id);


--
-- Name: free_agent_bids free_agent_bids_season_id_week_number_player_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_season_id_week_number_player_id_team_id_key UNIQUE (season_id, week_number, player_id, team_id);


--
-- Name: game_category_results game_category_results_game_id_team_id_category_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_category_results
    ADD CONSTRAINT game_category_results_game_id_team_id_category_key_key UNIQUE (game_id, team_id, category_key);


--
-- Name: game_category_results game_category_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_category_results
    ADD CONSTRAINT game_category_results_pkey PRIMARY KEY (id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: gms gms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gms
    ADD CONSTRAINT gms_pkey PRIMARY KEY (id);


--
-- Name: lineup_slots lineup_slots_lineup_id_position_id_slot_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_lineup_id_position_id_slot_type_key UNIQUE (lineup_id, position_id, slot_type);


--
-- Name: lineup_slots lineup_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_pkey PRIMARY KEY (id);


--
-- Name: market_state market_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_state
    ADD CONSTRAINT market_state_pkey PRIMARY KEY (season_id);


--
-- Name: matchup_lineups matchup_lineups_game_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matchup_lineups
    ADD CONSTRAINT matchup_lineups_game_id_team_id_key UNIQUE (game_id, team_id);


--
-- Name: matchup_lineups matchup_lineups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matchup_lineups
    ADD CONSTRAINT matchup_lineups_pkey PRIMARY KEY (id);


--
-- Name: player_game_stats player_game_stats_game_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_game_id_player_id_key UNIQUE (game_id, player_id);


--
-- Name: player_game_stats player_game_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_pkey PRIMARY KEY (id);


--
-- Name: players players_full_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_full_name_unique UNIQUE (full_name);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: playoff_series playoff_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playoff_series
    ADD CONSTRAINT playoff_series_pkey PRIMARY KEY (id);


--
-- Name: positions positions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_code_key UNIQUE (code);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: roster_contract_years roster_contract_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_contract_years
    ADD CONSTRAINT roster_contract_years_pkey PRIMARY KEY (id);


--
-- Name: roster_entries roster_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_pkey PRIMARY KEY (id);


--
-- Name: roster_entries roster_entries_team_id_player_id_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_team_id_player_id_season_key UNIQUE (team_id, player_id, season);


--
-- Name: roster_locks roster_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_locks
    ADD CONSTRAINT roster_locks_pkey PRIMARY KEY (id);


--
-- Name: roster_locks roster_locks_season_id_week_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_locks
    ADD CONSTRAINT roster_locks_season_id_week_number_key UNIQUE (season_id, week_number);


--
-- Name: seasons seasons_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_label_key UNIQUE (label);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: team_name_history team_name_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_name_history
    ADD CONSTRAINT team_name_history_pkey PRIMARY KEY (id);


--
-- Name: team_penalties team_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_penalties
    ADD CONSTRAINT team_penalties_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: transaction_approvals transaction_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_approvals
    ADD CONSTRAINT transaction_approvals_pkey PRIMARY KEY (id);


--
-- Name: transaction_approvals transaction_approvals_transaction_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_approvals
    ADD CONSTRAINT transaction_approvals_transaction_id_team_id_key UNIQUE (transaction_id, team_id);


--
-- Name: transaction_items transaction_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: weekly_rosters weekly_rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_rosters
    ADD CONSTRAINT weekly_rosters_pkey PRIMARY KEY (id);


--
-- Name: weekly_rosters weekly_rosters_season_id_week_number_team_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_rosters
    ADD CONSTRAINT weekly_rosters_season_id_week_number_team_id_player_id_key UNIQUE (season_id, week_number, team_id, player_id);


--
-- Name: draft_picks_current_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_picks_current_team_id_idx ON public.draft_picks USING btree (current_team_id);


--
-- Name: draft_picks_disputed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_picks_disputed_idx ON public.draft_picks USING btree (disputed) WHERE disputed;


--
-- Name: draft_picks_draft_season_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_picks_draft_season_id_idx ON public.draft_picks USING btree (draft_season_id);


--
-- Name: free_agent_bids_season_id_week_number_player_id_salary_offe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX free_agent_bids_season_id_week_number_player_id_salary_offe_idx ON public.free_agent_bids USING btree (season_id, week_number, player_id, salary_offer DESC, created_at);


--
-- Name: games_unique_playoff_game; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX games_unique_playoff_game ON public.games USING btree (playoff_series_id, game_number_in_series) WHERE (is_playoff = true);


--
-- Name: games_unique_regular_matchup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX games_unique_regular_matchup ON public.games USING btree (season_id, week_number, home_team_id, away_team_id, game_number_in_week) WHERE (is_playoff = false);


--
-- Name: idx_games_away_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_away_team ON public.games USING btree (away_team_id);


--
-- Name: idx_games_home_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_home_team ON public.games USING btree (home_team_id);


--
-- Name: idx_games_season_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_season_week ON public.games USING btree (season_id, week_number);


--
-- Name: idx_gcr_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcr_game ON public.game_category_results USING btree (game_id);


--
-- Name: idx_gcr_team_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcr_team_category ON public.game_category_results USING btree (team_id, category_key);


--
-- Name: idx_lineup_slots_lineup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lineup_slots_lineup ON public.lineup_slots USING btree (lineup_id);


--
-- Name: idx_matchup_lineups_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matchup_lineups_game ON public.matchup_lineups USING btree (game_id);


--
-- Name: idx_matchup_lineups_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matchup_lineups_team ON public.matchup_lineups USING btree (team_id);


--
-- Name: idx_pgs_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pgs_game ON public.player_game_stats USING btree (game_id);


--
-- Name: idx_pgs_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pgs_player ON public.player_game_stats USING btree (player_id);


--
-- Name: idx_pgs_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pgs_team ON public.player_game_stats USING btree (team_id);


--
-- Name: idx_playoff_series_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playoff_series_round ON public.playoff_series USING btree (season_id, round);


--
-- Name: idx_playoff_series_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playoff_series_season ON public.playoff_series USING btree (season_id);


--
-- Name: idx_roster_entries_player_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_entries_player_season ON public.roster_entries USING btree (player_id, season);


--
-- Name: idx_roster_entries_team_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_entries_team_season ON public.roster_entries USING btree (team_id, season);


--
-- Name: idx_roster_locks_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_locks_lookup ON public.roster_locks USING btree (season_id, week_number);


--
-- Name: idx_teams_gm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_gm ON public.teams USING btree (gm_id);


--
-- Name: idx_tnh_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tnh_team ON public.team_name_history USING btree (team_id);


--
-- Name: idx_weekly_rosters_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weekly_rosters_lookup ON public.weekly_rosters USING btree (season_id, week_number, team_id);


--
-- Name: ix_rcy_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rcy_entry ON public.roster_contract_years USING btree (roster_entry_id);


--
-- Name: ix_tp_team_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tp_team_season ON public.team_penalties USING btree (team_id, season_id);


--
-- Name: transaction_items_player_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_items_player_id_idx ON public.transaction_items USING btree (player_id);


--
-- Name: transaction_items_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_items_transaction_id_idx ON public.transaction_items USING btree (transaction_id);


--
-- Name: transactions_season_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_season_id_status_idx ON public.transactions USING btree (season_id, status);


--
-- Name: transactions_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_type_status_idx ON public.transactions USING btree (type, status);


--
-- Name: uq_lineup_titular_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_lineup_titular_unico ON public.lineup_slots USING btree (lineup_id, player_id) WHERE (slot_type = 'titular'::text);


--
-- Name: uq_rcy_entry_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_rcy_entry_label ON public.roster_contract_years USING btree (roster_entry_id, season_label);


--
-- Name: games trg_games_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_games_updated_at BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gms trg_gms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gms_updated_at BEFORE UPDATE ON public.gms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: players trg_players_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: playoff_series trg_playoff_series_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_playoff_series_updated_at BEFORE UPDATE ON public.playoff_series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roster_entries trg_roster_entries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roster_entries_updated_at BEFORE UPDATE ON public.roster_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: seasons trg_seasons_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seasons_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teams trg_teams_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: lineup_slots trg_validate_lineup_slot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_lineup_slot BEFORE INSERT OR UPDATE ON public.lineup_slots FOR EACH ROW EXECUTE FUNCTION public.validate_lineup_slot();


--
-- Name: draft_picks draft_picks_current_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_picks
    ADD CONSTRAINT draft_picks_current_team_id_fkey FOREIGN KEY (current_team_id) REFERENCES public.teams(id);


--
-- Name: draft_picks draft_picks_draft_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_picks
    ADD CONSTRAINT draft_picks_draft_season_id_fkey FOREIGN KEY (draft_season_id) REFERENCES public.seasons(id);


--
-- Name: draft_picks draft_picks_original_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_picks
    ADD CONSTRAINT draft_picks_original_team_id_fkey FOREIGN KEY (original_team_id) REFERENCES public.teams(id);


--
-- Name: draft_picks draft_picks_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_picks
    ADD CONSTRAINT draft_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: free_agent_bids free_agent_bids_gm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES public.gms(id);


--
-- Name: free_agent_bids free_agent_bids_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: free_agent_bids free_agent_bids_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: free_agent_bids free_agent_bids_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_agent_bids
    ADD CONSTRAINT free_agent_bids_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: game_category_results game_category_results_category_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_category_results
    ADD CONSTRAINT game_category_results_category_key_fkey FOREIGN KEY (category_key) REFERENCES public.categories(key);


--
-- Name: game_category_results game_category_results_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_category_results
    ADD CONSTRAINT game_category_results_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_category_results game_category_results_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_category_results
    ADD CONSTRAINT game_category_results_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: games games_away_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: games games_home_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: games games_playoff_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_playoff_series_id_fkey FOREIGN KEY (playoff_series_id) REFERENCES public.playoff_series(id) ON DELETE CASCADE;


--
-- Name: games games_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: gms gms_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gms
    ADD CONSTRAINT gms_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lineup_slots lineup_slots_lineup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_lineup_id_fkey FOREIGN KEY (lineup_id) REFERENCES public.matchup_lineups(id) ON DELETE CASCADE;


--
-- Name: lineup_slots lineup_slots_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: lineup_slots lineup_slots_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_slots
    ADD CONSTRAINT lineup_slots_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: market_state market_state_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_state
    ADD CONSTRAINT market_state_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id);


--
-- Name: market_state market_state_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_state
    ADD CONSTRAINT market_state_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: matchup_lineups matchup_lineups_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matchup_lineups
    ADD CONSTRAINT matchup_lineups_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: matchup_lineups matchup_lineups_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matchup_lineups
    ADD CONSTRAINT matchup_lineups_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: player_game_stats player_game_stats_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: player_game_stats player_game_stats_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE RESTRICT;


--
-- Name: player_game_stats player_game_stats_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_game_stats
    ADD CONSTRAINT player_game_stats_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: playoff_series playoff_series_higher_seed_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playoff_series
    ADD CONSTRAINT playoff_series_higher_seed_team_id_fkey FOREIGN KEY (higher_seed_team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: playoff_series playoff_series_lower_seed_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playoff_series
    ADD CONSTRAINT playoff_series_lower_seed_team_id_fkey FOREIGN KEY (lower_seed_team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: playoff_series playoff_series_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playoff_series
    ADD CONSTRAINT playoff_series_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: playoff_series playoff_series_winner_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playoff_series
    ADD CONSTRAINT playoff_series_winner_team_id_fkey FOREIGN KEY (winner_team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: roster_contract_years roster_contract_years_roster_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_contract_years
    ADD CONSTRAINT roster_contract_years_roster_entry_id_fkey FOREIGN KEY (roster_entry_id) REFERENCES public.roster_entries(id) ON DELETE CASCADE;


--
-- Name: roster_entries roster_entries_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: roster_entries roster_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: roster_locks roster_locks_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_locks
    ADD CONSTRAINT roster_locks_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id);


--
-- Name: roster_locks roster_locks_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_locks
    ADD CONSTRAINT roster_locks_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: team_name_history team_name_history_from_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_name_history
    ADD CONSTRAINT team_name_history_from_season_id_fkey FOREIGN KEY (from_season_id) REFERENCES public.seasons(id);


--
-- Name: team_name_history team_name_history_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_name_history
    ADD CONSTRAINT team_name_history_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_name_history team_name_history_to_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_name_history
    ADD CONSTRAINT team_name_history_to_season_id_fkey FOREIGN KEY (to_season_id) REFERENCES public.seasons(id);


--
-- Name: team_penalties team_penalties_origin_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_penalties
    ADD CONSTRAINT team_penalties_origin_team_id_fkey FOREIGN KEY (origin_team_id) REFERENCES public.teams(id);


--
-- Name: team_penalties team_penalties_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_penalties
    ADD CONSTRAINT team_penalties_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: team_penalties team_penalties_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_penalties
    ADD CONSTRAINT team_penalties_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: teams teams_first_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_first_season_id_fkey FOREIGN KEY (first_season_id) REFERENCES public.seasons(id);


--
-- Name: teams teams_gm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES public.gms(id) ON DELETE RESTRICT;


--
-- Name: teams teams_last_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_last_season_id_fkey FOREIGN KEY (last_season_id) REFERENCES public.seasons(id);


--
-- Name: transaction_approvals transaction_approvals_gm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_approvals
    ADD CONSTRAINT transaction_approvals_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES public.gms(id);


--
-- Name: transaction_approvals transaction_approvals_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_approvals
    ADD CONSTRAINT transaction_approvals_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: transaction_approvals transaction_approvals_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_approvals
    ADD CONSTRAINT transaction_approvals_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transaction_items transaction_items_from_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_from_team_id_fkey FOREIGN KEY (from_team_id) REFERENCES public.teams(id);


--
-- Name: transaction_items transaction_items_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.draft_picks(id);


--
-- Name: transaction_items transaction_items_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: transaction_items transaction_items_source_penalty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_source_penalty_id_fkey FOREIGN KEY (source_penalty_id) REFERENCES public.team_penalties(id);


--
-- Name: transaction_items transaction_items_to_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_to_team_id_fkey FOREIGN KEY (to_team_id) REFERENCES public.teams(id);


--
-- Name: transaction_items transaction_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_admin_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_admin_decided_by_fkey FOREIGN KEY (admin_decided_by) REFERENCES public.gms(id);


--
-- Name: transactions transactions_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.gms(id);


--
-- Name: transactions transactions_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: weekly_rosters weekly_rosters_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_rosters
    ADD CONSTRAINT weekly_rosters_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: weekly_rosters weekly_rosters_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_rosters
    ADD CONSTRAINT weekly_rosters_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: weekly_rosters weekly_rosters_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_rosters
    ADD CONSTRAINT weekly_rosters_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: gms Admins can manage GMs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage GMs" ON public.gms TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can manage all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all roles" ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: categories Admins can manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage categories" ON public.categories TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: game_category_results Admins can manage game category results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage game category results" ON public.game_category_results TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: games Admins can manage games; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage games" ON public.games TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: player_game_stats Admins can manage player game stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage player game stats" ON public.player_game_stats TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: players Admins can manage players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage players" ON public.players TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: playoff_series Admins can manage playoff series; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage playoff series" ON public.playoff_series TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: roster_entries Admins can manage roster entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage roster entries" ON public.roster_entries TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: seasons Admins can manage seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage seasons" ON public.seasons TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: team_name_history Admins can manage team name history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage team name history" ON public.team_name_history TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: teams Admins can manage teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage teams" ON public.teams TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: categories Categories are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Categories are publicly viewable" ON public.categories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: draft_picks Draft picks are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Draft picks are publicly viewable" ON public.draft_picks FOR SELECT TO authenticated, anon USING (true);


--
-- Name: gms GMs are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "GMs are publicly viewable" ON public.gms FOR SELECT TO authenticated, anon USING (true);


--
-- Name: game_category_results Game category results are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Game category results are publicly viewable" ON public.game_category_results FOR SELECT TO authenticated, anon USING (true);


--
-- Name: games Games are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Games are publicly viewable" ON public.games FOR SELECT TO authenticated, anon USING (true);


--
-- Name: player_game_stats Player game stats are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Player game stats are publicly viewable" ON public.player_game_stats FOR SELECT TO authenticated, anon USING (true);


--
-- Name: players Players are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players are publicly viewable" ON public.players FOR SELECT TO authenticated, anon USING (true);


--
-- Name: playoff_series Playoff series are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Playoff series are publicly viewable" ON public.playoff_series FOR SELECT TO authenticated, anon USING (true);


--
-- Name: roster_entries Roster entries are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Roster entries are publicly viewable" ON public.roster_entries FOR SELECT TO authenticated, anon USING (true);


--
-- Name: seasons Seasons are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Seasons are publicly viewable" ON public.seasons FOR SELECT TO authenticated, anon USING (true);


--
-- Name: team_name_history Team name history is publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team name history is publicly viewable" ON public.team_name_history FOR SELECT TO authenticated, anon USING (true);


--
-- Name: teams Teams are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teams are publicly viewable" ON public.teams FOR SELECT TO authenticated, anon USING (true);


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_picks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

--
-- Name: free_agent_bids; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.free_agent_bids ENABLE ROW LEVEL SECURITY;

--
-- Name: game_category_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_category_results ENABLE ROW LEVEL SECURITY;

--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: gms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gms ENABLE ROW LEVEL SECURITY;

--
-- Name: lineup_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lineup_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: lineup_slots lineup_slots: owner or admin write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "lineup_slots: owner or admin write" ON public.lineup_slots USING ((public.has_role('admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.matchup_lineups ml
  WHERE ((ml.id = lineup_slots.lineup_id) AND (ml.team_id = public.current_team_id())))))) WITH CHECK ((public.has_role('admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.matchup_lineups ml
  WHERE ((ml.id = lineup_slots.lineup_id) AND (ml.team_id = public.current_team_id()))))));


--
-- Name: lineup_slots lineup_slots: secret until lock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "lineup_slots: secret until lock" ON public.lineup_slots FOR SELECT USING ((public.has_role('admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.matchup_lineups ml
  WHERE ((ml.id = lineup_slots.lineup_id) AND (ml.team_id = public.current_team_id())))) OR (EXISTS ( SELECT 1
   FROM ((public.matchup_lineups ml
     JOIN public.games g ON ((g.id = ml.game_id)))
     JOIN public.roster_locks rl ON (((rl.season_id = g.season_id) AND (rl.week_number = g.week_number))))
  WHERE ((ml.id = lineup_slots.lineup_id) AND (now() >= rl.locks_at))))));


--
-- Name: market_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_state ENABLE ROW LEVEL SECURITY;

--
-- Name: matchup_lineups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matchup_lineups ENABLE ROW LEVEL SECURITY;

--
-- Name: matchup_lineups matchup_lineups: owner or admin write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "matchup_lineups: owner or admin write" ON public.matchup_lineups USING (((team_id = public.current_team_id()) OR public.has_role('admin'::public.app_role))) WITH CHECK (((team_id = public.current_team_id()) OR public.has_role('admin'::public.app_role)));


--
-- Name: matchup_lineups matchup_lineups: public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "matchup_lineups: public read" ON public.matchup_lineups FOR SELECT USING (true);


--
-- Name: player_game_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_game_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: playoff_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.playoff_series ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: positions positions: public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "positions: public read" ON public.positions FOR SELECT USING (true);


--
-- Name: roster_contract_years public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.roster_contract_years FOR SELECT USING (true);


--
-- Name: team_penalties public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.team_penalties FOR SELECT USING (true);


--
-- Name: roster_contract_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_contract_years ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_locks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_locks ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_locks roster_locks: admin write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "roster_locks: admin write" ON public.roster_locks USING (public.has_role('admin'::public.app_role)) WITH CHECK (public.has_role('admin'::public.app_role));


--
-- Name: roster_locks roster_locks: public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "roster_locks: public read" ON public.roster_locks FOR SELECT USING (true);


--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: team_name_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_name_history ENABLE ROW LEVEL SECURITY;

--
-- Name: team_penalties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_penalties ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles user_roles: admin write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user_roles: admin write" ON public.user_roles USING (public.has_role('admin'::public.app_role)) WITH CHECK (public.has_role('admin'::public.app_role));


--
-- Name: user_roles user_roles: self read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user_roles: self read" ON public.user_roles FOR SELECT USING (((user_id = auth.uid()) OR public.has_role('admin'::public.app_role)));


--
-- Name: weekly_rosters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_rosters ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_rosters weekly_rosters: admin write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "weekly_rosters: admin write" ON public.weekly_rosters USING (public.has_role('admin'::public.app_role)) WITH CHECK (public.has_role('admin'::public.app_role));


--
-- Name: weekly_rosters weekly_rosters: public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "weekly_rosters: public read" ON public.weekly_rosters FOR SELECT USING (true);


--
-- PostgreSQL database dump complete
--

\unrestrict 160c3rgsZIMAznnVE2dEnddzerhmrc5M9Ez3mEOdd5oQ6mdGJ7zTlcuoRCRbg6e

