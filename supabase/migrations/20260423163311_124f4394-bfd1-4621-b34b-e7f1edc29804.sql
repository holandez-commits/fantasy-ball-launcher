
-- Seasons table
CREATE TABLE public.seasons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  start_year INTEGER NOT NULL,
  end_year INTEGER NOT NULL,
  total_weeks INTEGER NOT NULL DEFAULT 17,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Games table (one row per matchup)
CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  home_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  away_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  home_stats JSONB,
  away_stats JSONB,
  category_results JSONB,
  source_post_url TEXT,
  source_sheet_url TEXT,
  source_sheet_tab TEXT,
  played_on DATE,
  is_playoff BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, week_number, home_team_id, away_team_id, source_sheet_tab)
);

CREATE INDEX idx_games_season_week ON public.games(season_id, week_number);
CREATE INDEX idx_games_home_team ON public.games(home_team_id);
CREATE INDEX idx_games_away_team ON public.games(away_team_id);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seasons are publicly viewable"
  ON public.seasons FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage seasons"
  ON public.seasons FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Games are publicly viewable"
  ON public.games FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage games"
  ON public.games FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER seasons_set_updated_at
  BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
