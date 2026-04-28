ALTER TABLE public.games 
  DROP CONSTRAINT IF EXISTS games_season_id_week_number_home_team_id_away_team_id_sour_key;

ALTER TABLE public.games DROP COLUMN IF EXISTS home_stats;
ALTER TABLE public.games DROP COLUMN IF EXISTS away_stats;
ALTER TABLE public.games DROP COLUMN IF EXISTS category_results;

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS game_number_in_week INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS game_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_unique_matchup'
  ) THEN
    ALTER TABLE public.games 
      ADD CONSTRAINT games_unique_matchup 
      UNIQUE (season_id, week_number, home_team_id, away_team_id, game_number_in_week);
  END IF;
END $$;