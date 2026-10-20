-- 20261019 — Adiciona AND g.status='final' nas 3 RPCs de standings/stats.
-- Com o calendário 26/27 carregado como jogos 'scheduled' (placar NULL), sem esse
-- filtro as RPCs somavam jogos sem placar (classificação/médias poluídas na 26/27).
-- Resolve a pendência "WHERE status='final' nas RPCs" do ESTADO. Verificado: 26/27
-- volta com 0 jogos; 25/26 intacta. Rodado via MCP no PROD (sessão 11).

CREATE OR REPLACE FUNCTION public.get_standings(season_ids uuid[])
 RETURNS TABLE(team_id uuid, w bigint, d bigint, l bigint, gp bigint)
 LANGUAGE plpgsql
AS $function$
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
    AND g.status = 'final'
  GROUP BY t.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.team_season_standings(season_ids uuid[])
 RETURNS TABLE(team_id uuid, team_name text, season_id uuid, season_label text, w bigint, d bigint, l bigint, gp bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    t.id   AS team_id,
    t.name AS team_name,
    g.season_id AS season_id,
    s.label AS season_label,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id AND g.home_score > g.away_score) OR (g.away_team_id = t.id AND g.away_score > g.home_score)) AS w,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id OR g.away_team_id = t.id) AND g.home_score = g.away_score) AS d,
    COUNT(*) FILTER (WHERE (g.home_team_id = t.id AND g.home_score < g.away_score) OR (g.away_team_id = t.id AND g.away_score < g.home_score)) AS l,
    COUNT(*) FILTER (WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS gp
  FROM teams t
  JOIN games g ON (g.home_team_id = t.id OR g.away_team_id = t.id)
  JOIN seasons s ON s.id = g.season_id
  WHERE g.season_id = ANY(season_ids)
    AND g.is_playoff = false
    AND g.status = 'final'
  GROUP BY t.id, t.name, g.season_id, s.label;
END;
$function$;

CREATE OR REPLACE FUNCTION public.team_game_stats_totals(season_ids uuid[])
 RETURNS TABLE(game_id uuid, team_id uuid, team_name text, season_id uuid, season_label text, week_number integer, opp_name text, pts numeric, reb numeric, ast numeric, stl numeric, blk numeric, three_pm numeric, turnovers numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    g.id AS game_id,
    pgs.team_id AS team_id,
    t.name AS team_name,
    g.season_id AS season_id,
    s.label AS season_label,
    g.week_number AS week_number,
    opp.name AS opp_name,
    SUM(pgs.pts)::NUMERIC AS pts,
    SUM(pgs.reb)::NUMERIC AS reb,
    SUM(pgs.ast)::NUMERIC AS ast,
    SUM(pgs.stl)::NUMERIC AS stl,
    SUM(pgs.blk)::NUMERIC AS blk,
    SUM(pgs.three_pm)::NUMERIC AS three_pm,
    SUM(pgs.turnovers)::NUMERIC AS turnovers
  FROM player_game_stats pgs
  JOIN games g ON g.id = pgs.game_id
  JOIN teams t ON t.id = pgs.team_id
  JOIN seasons s ON s.id = g.season_id
  JOIN teams opp ON opp.id = CASE WHEN g.home_team_id = pgs.team_id THEN g.away_team_id ELSE g.home_team_id END
  WHERE g.season_id = ANY(season_ids)
    AND g.is_playoff = false
    AND g.status = 'final'
  GROUP BY g.id, pgs.team_id, t.name, g.season_id, s.label, g.week_number, opp.name;
END;
$function$;
