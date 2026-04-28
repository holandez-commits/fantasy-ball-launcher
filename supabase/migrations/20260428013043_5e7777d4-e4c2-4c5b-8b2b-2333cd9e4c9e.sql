-- Categories (lookup)
CREATE TABLE IF NOT EXISTS public.categories (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  lower_is_better BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories are publicly viewable" ON public.categories;
CREATE POLICY "Categories are publicly viewable"
  ON public.categories FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
CREATE POLICY "Admins can manage categories"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Game category results
CREATE TABLE IF NOT EXISTS public.game_category_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL REFERENCES public.categories(key),
  value NUMERIC NOT NULL,
  won_category BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, team_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_gcr_game ON public.game_category_results(game_id);
CREATE INDEX IF NOT EXISTS idx_gcr_team_category ON public.game_category_results(team_id, category_key);

ALTER TABLE public.game_category_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Game category results are publicly viewable" ON public.game_category_results;
CREATE POLICY "Game category results are publicly viewable"
  ON public.game_category_results FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage game category results" ON public.game_category_results;
CREATE POLICY "Admins can manage game category results"
  ON public.game_category_results FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Player game stats
CREATE TABLE IF NOT EXISTS public.player_game_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  pts NUMERIC NOT NULL DEFAULT 0,
  reb NUMERIC NOT NULL DEFAULT 0,
  ast NUMERIC NOT NULL DEFAULT 0,
  stl NUMERIC NOT NULL DEFAULT 0,
  blk NUMERIC NOT NULL DEFAULT 0,
  three_pm NUMERIC NOT NULL DEFAULT 0,
  turnovers NUMERIC NOT NULL DEFAULT 0,
  lineup_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_pgs_game ON public.player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_pgs_player ON public.player_game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_pgs_team ON public.player_game_stats(team_id);

ALTER TABLE public.player_game_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Player game stats are publicly viewable" ON public.player_game_stats;
CREATE POLICY "Player game stats are publicly viewable"
  ON public.player_game_stats FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage player game stats" ON public.player_game_stats;
CREATE POLICY "Admins can manage player game stats"
  ON public.player_game_stats FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));