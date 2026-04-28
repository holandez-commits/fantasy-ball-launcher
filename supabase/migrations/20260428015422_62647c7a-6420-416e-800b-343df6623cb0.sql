CREATE TABLE IF NOT EXISTS public.team_name_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  from_season_id UUID REFERENCES public.seasons(id),
  to_season_id UUID REFERENCES public.seasons(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.team_name_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team name history is publicly viewable" ON public.team_name_history;
CREATE POLICY "Team name history is publicly viewable"
  ON public.team_name_history FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage team name history" ON public.team_name_history;
CREATE POLICY "Admins can manage team name history"
  ON public.team_name_history FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.categories (key, display_name, display_order, lower_is_better) VALUES
  ('pts',  'Pontos',       1, false),
  ('reb',  'Rebotes',      2, false),
  ('ast',  'Assistências', 3, false),
  ('stl',  'Roubos',       4, false),
  ('blk',  'Tocos',        5, false),
  ('3pm',  'Bolas de 3',   6, false),
  ('to',   'Turnovers',    7, true)
ON CONFLICT (key) DO NOTHING;