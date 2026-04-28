-- Campos extras em gms, seasons e teams
ALTER TABLE public.gms ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.gms ADD COLUMN IF NOT EXISTS whatsapp TEXT;

ALTER TABLE public.seasons ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS conference TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_conference_check') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_conference_check
      CHECK (conference IN ('Donut', 'Bad Boys'));
  END IF;
END $$;

-- Ajustes em games para suportar playoffs e empates
ALTER TABLE public.games ALTER COLUMN week_number DROP NOT NULL;

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS playoff_round TEXT;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS playoff_series_id UUID;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS game_number_in_series INTEGER;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS tied_categories INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_playoff_round_check') THEN
    ALTER TABLE public.games ADD CONSTRAINT games_playoff_round_check
      CHECK (playoff_round IN ('first_round', 'conference_semis', 'conference_final', 'finals'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_game_number_in_series_check') THEN
    ALTER TABLE public.games ADD CONSTRAINT games_game_number_in_series_check
      CHECK (game_number_in_series BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_tied_categories_check') THEN
    ALTER TABLE public.games ADD CONSTRAINT games_tied_categories_check
      CHECK (tied_categories BETWEEN 0 AND 7);
  END IF;
END $$;

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_unique_matchup;

CREATE UNIQUE INDEX IF NOT EXISTS games_unique_regular_matchup
  ON public.games (season_id, week_number, home_team_id, away_team_id, game_number_in_week)
  WHERE is_playoff = false;

CREATE UNIQUE INDEX IF NOT EXISTS games_unique_playoff_game
  ON public.games (playoff_series_id, game_number_in_series)
  WHERE is_playoff = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_regular_has_week') THEN
    ALTER TABLE public.games ADD CONSTRAINT games_regular_has_week
      CHECK (
        (is_playoff = false AND week_number IS NOT NULL AND playoff_series_id IS NULL)
        OR
        (is_playoff = true AND playoff_series_id IS NOT NULL AND game_number_in_series IS NOT NULL)
      );
  END IF;
END $$;

-- Tabela playoff_series
CREATE TABLE IF NOT EXISTS public.playoff_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  round TEXT NOT NULL
    CHECK (round IN ('first_round', 'conference_semis', 'conference_final', 'finals')),
  conference TEXT
    CHECK (conference IN ('Donut', 'Bad Boys')),
  higher_seed_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  higher_seed_position INTEGER CHECK (higher_seed_position BETWEEN 1 AND 8),
  lower_seed_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  lower_seed_position INTEGER CHECK (lower_seed_position BETWEEN 1 AND 8),
  winner_team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT,
  higher_seed_wins INTEGER NOT NULL DEFAULT 0,
  lower_seed_wins INTEGER NOT NULL DEFAULT 0,
  series_ties INTEGER NOT NULL DEFAULT 0,
  tiebreak_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT playoff_series_conference_consistency CHECK (
    (round IN ('first_round', 'conference_semis', 'conference_final') AND conference IS NOT NULL)
    OR (round = 'finals' AND conference IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_playoff_series_season ON public.playoff_series(season_id);
CREATE INDEX IF NOT EXISTS idx_playoff_series_round ON public.playoff_series(season_id, round);

ALTER TABLE public.playoff_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Playoff series are publicly viewable" ON public.playoff_series;
CREATE POLICY "Playoff series are publicly viewable"
  ON public.playoff_series FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage playoff series" ON public.playoff_series;
CREATE POLICY "Admins can manage playoff series"
  ON public.playoff_series FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_playoff_series_updated_at ON public.playoff_series;
CREATE TRIGGER trg_playoff_series_updated_at
  BEFORE UPDATE ON public.playoff_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_playoff_series_fk') THEN
    ALTER TABLE public.games
      ADD CONSTRAINT games_playoff_series_fk
      FOREIGN KEY (playoff_series_id) REFERENCES public.playoff_series(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Dados iniciais: temporada 25/26
INSERT INTO public.seasons (label, start_year, end_year, total_weeks, is_current, is_completed)
SELECT '25/26', 2025, 2026, 17, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE label = '25/26');

-- Dados iniciais: 24 GMs
INSERT INTO public.gms (full_name, nickname, email)
SELECT v.full_name, v.nickname, v.email
FROM (VALUES
  ('Artur Rauen',        'Tutu',         'arturmr@gmail.com'),
  ('Guilherme Lemes',    'Lemes',        'guilhermeclemes@gmail.com'),
  ('Vitor Sampaio',      'Vitor',        'sampaio.parapapao@gmail.com'),
  ('André Rocha',        'André',        'andre.c.rocha@gmail.com'),
  ('Vinícius Gianini',   'Vini',         'viniciusgiannini@gmail.com'),
  ('Charles Sansaloni',  'Charlinho',    'charleskrop@gmail.com'),
  ('Fabão',              'Fabão',        'fabao@hotmail.com'),
  ('Daniel Damasceno',   'Daniel',       'camposoilers@gmail.com'),
  ('Denis Botana',       'Fundador',     'denis.botana@gmail.com'),
  ('Diogo Costa',        'Diogotur',     'jpakissflowers@gmail.com'),
  ('Geison',             'Geison',       'geisonviper@gmail.com'),
  ('Caique Soares',      'Showares',     'caiqueshowares@gmail.com'),
  ('Paulinho',           'Paulinho',     'paulodimensional@gmail.com'),
  ('Guilherme Fonseca',  'Fonseca',      'gui91cf@hotmail.com'),
  ('Guilherme Rubio',    'Rubio',        'holandez@gmail.com'),
  ('Martin',             'Martin',       'correiodomartin@gmail.com'),
  ('Cassyus Silva',      'Cassyus',      'caassyus@gmail.com'),
  ('Rafael Campos',      'Rafa',         'karlekdoden@yahoo.com.br'),
  ('Igor Lima',          'Igor',         'guigolima45@gmail.com'),
  ('Caio Blois',         'Mestre',       'denguestateoutlawz@gmail.com'),
  ('Thiago Martins',     'Thiagão',      'camposlighthalzen@gmail.com'),
  ('William Xavier',     'William',      'williamfxavier@gmail.com'),
  ('Luis Guilherme',     'LG',           'lugudecaro@gmail.com'),
  ('Luiz Fernando',      'LF',           'nba.luizfernando@gmail.com')
) AS v(full_name, nickname, email)
WHERE NOT EXISTS (SELECT 1 FROM public.gms g WHERE g.full_name = v.full_name);

-- Dados iniciais: 24 times
INSERT INTO public.teams (name, abbreviation, slug, city, conference, gm_id, first_season_id, is_active)
SELECT t.name, t.abbreviation, t.slug, t.city, t.conference,
       (SELECT id FROM public.gms WHERE full_name = t.gm_full_name),
       (SELECT id FROM public.seasons WHERE label = '25/26'),
       true
FROM (VALUES
  ('Floripa Waves',                'WAV', 'floripa-waves',                'Florianópolis',         'Donut',     'Artur Rauen'),
  ('Cambuquira Pure Water',        'PUR', 'cambuquira-pure-water',        'Cambuquira',            'Bad Boys',  'Guilherme Lemes'),
  ('Pará Papão',                   'PAP', 'para-papao',                   'Belém',                 'Donut',     'Vitor Sampaio'),
  ('Brasilia Carcarás',            'CAR', 'brasilia-carcaras',            'Brasília',              'Bad Boys',  'André Rocha'),
  ('SP Horse Ride',                'HOR', 'sp-horse-ride',                'Salto de Pirapora',     'Donut',     'Vinícius Gianini'),
  ('Goiânia Old Devils',           'OLD', 'goiania-old-devils',           'Goiânia',               'Donut',     'Charles Sansaloni'),
  ('Tijuca Rocks',                 'ROC', 'tijuca-rocks',                 'Rio de Janeiro',        'Bad Boys',  'Fabão'),
  ('Campos Oilers',                'OIL', 'campos-oilers',                'Campos de Goytacazes',  'Donut',     'Daniel Damasceno'),
  ('Pinheiros Racecars',           'RAC', 'pinheiros-racecars',           'São Paulo',             'Donut',     'Denis Botana'),
  ('JPA KissFlowers',              'JPA', 'jpa-kissflowers',              'Rio de Janeiro',        'Bad Boys',  'Diogo Costa'),
  ('Blumenau Assassins',           'ASS', 'blumenau-assassins',           'Blumenau',              'Bad Boys',  'Geison'),
  ('Lavras Big Balls',             'BIG', 'lavras-big-balls',             'Lavras',                'Donut',     'Caique Soares'),
  ('João Pessoa Fats',             'FAT', 'joao-pessoa-fats',             'João Pessoa',           'Bad Boys',  'Paulinho'),
  ('Rio Preto Capivaras',          'CAP', 'rio-preto-capivaras',          'Rio Preto',             'Donut',     'Guilherme Fonseca'),
  ('Santo André Balboas',          'BAL', 'santo-andre-balboas',          'Santo André',           'Donut',     'Guilherme Rubio'),
  ('Palmas Mamiferos',             'MAM', 'palmas-mamiferos',             'Palmas',                'Donut',     'Martin'),
  ('Porto Alegre Ornitorrincos',   'ORN', 'porto-alegre-ornitorrincos',   'Porto Alegre',          'Bad Boys',  'Cassyus Silva'),
  ('São Paulo TrafficJam',         'TRA', 'sao-paulo-trafficjam',         'São Paulo',             'Bad Boys',  'Rafael Campos'),
  ('Recife Gold Lions',            'LIO', 'recife-gold-lions',            'Recife',                'Bad Boys',  'Igor Lima'),
  ('Dengue State Outlawz',         'OUT', 'dengue-state-outlawz',         'Rio de Janeiro',        'Bad Boys',  'Caio Blois'),
  ('Campos Lighthalzen',           'LIG', 'campos-lighthalzen',           'Campos de Goytacazes',  'Donut',     'Thiago Martins'),
  ('Prudente Bengals',             'BEN', 'prudente-bengals',             'Presidente Prudente',   'Donut',     'William Xavier'),
  ('RJ Drugdealers',               'DRU', 'rj-drugdealers',               'Rio de Janeiro',        'Bad Boys',  'Luis Guilherme'),
  ('Campinas Color Blinds',        'BLI', 'campinas-color-blinds',        'Campinas',              'Bad Boys',  'Luiz Fernando')
) AS t(name, abbreviation, slug, city, conference, gm_full_name)
WHERE NOT EXISTS (SELECT 1 FROM public.teams existing WHERE existing.slug = t.slug);