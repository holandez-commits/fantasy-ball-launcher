-- Ajustes em players (de NFL para NBA)
ALTER TABLE public.players DROP COLUMN IF EXISTS nfl_team;
ALTER TABLE public.players DROP COLUMN IF EXISTS bye_week;
ALTER TABLE public.players DROP COLUMN IF EXISTS jersey_number;
ALTER TABLE public.players DROP COLUMN IF EXISTS position;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS nba_team TEXT;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS positions TEXT[];

-- Ajustes em seasons
ALTER TABLE public.seasons ADD COLUMN IF NOT EXISTS playoff_start_week INTEGER;
ALTER TABLE public.seasons ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

-- Ajustes em teams (Opção B: cada time = um GM em uma era)
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_abbreviation_key;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_slug_key;
ALTER TABLE public.teams ALTER COLUMN gm_id SET NOT NULL;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS first_season_id UUID REFERENCES public.seasons(id);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS last_season_id UUID REFERENCES public.seasons(id);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;