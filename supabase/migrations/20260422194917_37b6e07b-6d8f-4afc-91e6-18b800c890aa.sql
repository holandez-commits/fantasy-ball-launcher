-- Roles infrastructure (must come first)
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- GMs
CREATE TABLE public.gms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  nickname TEXT,
  bio TEXT,
  avatar_url TEXT,
  joined_year INTEGER,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.gms ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_gms_updated_at
  BEFORE UPDATE ON public.gms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "GMs are publicly viewable"
  ON public.gms FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage GMs"
  ON public.gms FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Teams
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  city TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  logo_url TEXT,
  founded_year INTEGER,
  gm_id UUID REFERENCES public.gms(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Teams are publicly viewable"
  ON public.teams FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage teams"
  ON public.teams FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Players (NFL pool)
CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL,
  nfl_team TEXT,
  jersey_number INTEGER,
  bye_week INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Players are publicly viewable"
  ON public.players FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage players"
  ON public.players FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Roster entries (team + player + season)
CREATE TABLE public.roster_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  slot TEXT NOT NULL DEFAULT 'bench',
  status TEXT NOT NULL DEFAULT 'active',
  acquired_via TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (team_id, player_id, season)
);

ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_roster_entries_updated_at
  BEFORE UPDATE ON public.roster_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Roster entries are publicly viewable"
  ON public.roster_entries FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage roster entries"
  ON public.roster_entries FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_roster_entries_team_season ON public.roster_entries(team_id, season);
CREATE INDEX idx_roster_entries_player_season ON public.roster_entries(player_id, season);
CREATE INDEX idx_teams_gm ON public.teams(gm_id);