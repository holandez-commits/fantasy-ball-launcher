import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import {
  ArrowUpRight, Trophy, Users, CalendarDays, ClipboardList,
  BarChart2, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = { id: string; label: string; start_year: number; is_current: boolean };

type TeamRow = {
  id: string;
  name: string;
  slug: string;
  conference: string | null;
  logo_url: string | null;
  primary_color: string | null;
  is_active: boolean;
};

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  week_number: number | null;
  season_id: string;
};

type WeekEntry = { season_id: string; week_number: number };

type StandingEntry = {
  team: TeamRow;
  w: number; d: number; l: number; gp: number; pct: number;
};

type TabId = "geral" | "donut" | "badboys";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Liga Bola Presa de Fantasy" },
      { name: "description", content: "Acompanhe a Liga Bola Presa de Fantasy NBA." },
    ],
  }),
  component: HomePage,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const shortcuts = [
  { to: "/elencos",    label: "Elencos",    desc: "Times e jogadores",        icon: Users },
  { to: "/gms",        label: "GMs",        desc: "General Managers",         icon: Users },
  { to: "/medias",     label: "Médias",     desc: "Desempenho por categoria",  icon: BarChart2 },
  { to: "/recordes",   label: "Recordes",   desc: "Marcas históricas",         icon: Trophy },
  { to: "/escalacoes", label: "Escalações", desc: "Quem joga essa semana",     icon: ClipboardList },
  { to: "/calendario", label: "Calendário", desc: "Próximas rodadas",          icon: CalendarDays },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function pctStr(w: number, gp: number) {
  if (gp === 0) return ".000";
  return (w / gp).toFixed(3).replace(/^0/, "");
}

function pctColor(pct: number): string {
  if (pct >= 0.65) return "text-purple-600 dark:text-purple-400";
  if (pct >= 0.5)  return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 0.35) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function buildStandings(teams: TeamRow[], games: GameRow[]): StandingEntry[] {
  const map = new Map<string, { w: number; d: number; l: number }>();
  for (const t of teams) map.set(t.id, { w: 0, d: 0, l: 0 });

  for (const g of games) {
    const home = map.get(g.home_team_id);
    const away = map.get(g.away_team_id);
    if (g.home_score > g.away_score) { if (home) home.w++; if (away) away.l++; }
    else if (g.away_score > g.home_score) { if (away) away.w++; if (home) home.l++; }
    else { if (home) home.d++; if (away) away.d++; }
  }

  return teams.map((team) => {
    const rec = map.get(team.id) ?? { w: 0, d: 0, l: 0 };
    const gp = rec.w + rec.d + rec.l;
    return { team, ...rec, gp, pct: gp > 0 ? rec.w / gp : 0 };
  }).sort((a, b) => b.w - a.w || b.d - a.d || a.team.name.localeCompare(b.team.name));
}

// ─── TeamLogo ─────────────────────────────────────────────────────────────────

function TeamLogo({ team }: { team: TeamRow }) {
  const bg = team.primary_color ?? "#374151";
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shrink-0"
      style={{ background: bg }}
    >
      {team.logo_url
        ? <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
        : <span>{teamInitials(team.name)}</span>
      }
    </div>
  );
}

// ─── SimpleDropdown ───────────────────────────────────────────────────────────

function SimpleDropdown<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
      >
        <span>{current?.label ?? "—"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-48 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
            <ul className="py-1">
              {options.map((opt) => (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    onClick={() => { onChange(opt.value); setOpen(false); }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                      opt.value === value && "font-medium text-[color:var(--court)]"
                    )}
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ─── StandingsMini ────────────────────────────────────────────────────────────

function StandingsMini({ entries }: { entries: StandingEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2.5 w-7">#</th>
            <th className="w-9 py-2.5 pl-2 pr-0" />
            <th className="px-3 py-2.5 text-left">Time</th>
            <th className="px-3 py-2.5 text-right">V</th>
            <th className="px-3 py-2.5 text-right">E</th>
            <th className="px-3 py-2.5 text-right">D</th>
            <th className="px-3 py-2.5 text-right">PCT</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.team.id} className={cn(
              "border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors",
              i % 2 === 1 ? "bg-muted/10" : "",
              !e.team.is_active ? "opacity-60" : ""
            )}>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
              <td className="py-2 pl-2 pr-0"><TeamLogo team={e.team} /></td>
              <td className="px-3 py-2">
                <Link
                  to="/times/$slug"
                  params={{ slug: e.team.slug }}
                  className="font-medium hover:underline hover:text-[color:var(--court)]"
                >
                  {e.team.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{e.w}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{e.d}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{e.l}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums font-medium", pctColor(e.pct))}>
                {pctStr(e.w, e.gp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── GamesSection ─────────────────────────────────────────────────────────────

function GamesSection({
  seasons,
  weeksIndex,
  teamMap,
  defaultSeasonId,
  defaultWeek,
}: {
  seasons: Season[];
  weeksIndex: WeekEntry[];
  teamMap: Map<string, TeamRow>;
  defaultSeasonId: string;
  defaultWeek: number | null;
}) {
  const [selectedSeasonId, setSelectedSeasonId] = useState(defaultSeasonId);
  const [selectedWeek, setSelectedWeek]         = useState<number | null>(defaultWeek);
  const [weekGames, setWeekGames]               = useState<GameRow[]>([]);
  const [loadingGames, setLoadingGames]         = useState(false);

  // Semanas disponíveis para a temporada selecionada
  const weekOptions = useMemo(() => {
    const weeks = [...new Set(
      weeksIndex
        .filter((w) => w.season_id === selectedSeasonId)
        .map((w) => w.week_number)
    )].sort((a, b) => a - b);
    return weeks.map((w) => ({ value: w, label: `Semana ${w}` }));
  }, [weeksIndex, selectedSeasonId]);

  // Quando muda de temporada, vai para a última semana dessa temporada
  useEffect(() => {
    if (weekOptions.length > 0) {
      setSelectedWeek(weekOptions[weekOptions.length - 1].value);
    }
  }, [selectedSeasonId]);

  // Busca jogos da semana selecionada sob demanda
  useEffect(() => {
    if (!selectedSeasonId || selectedWeek == null) return;

    setLoadingGames(true);
    supabase
      .from("games")
      .select("id, home_team_id, away_team_id, home_score, away_score, week_number, season_id")
      .eq("season_id", selectedSeasonId)
      .eq("week_number", selectedWeek)
      .eq("is_playoff", false)
      .then(({ data }) => {
        setWeekGames((data as GameRow[]) ?? []);
        setLoadingGames(false);
      });
  }, [selectedSeasonId, selectedWeek]);

  const seasonOptions = seasons.map((s) => ({ value: s.id, label: `Temporada ${s.label}` }));
  const activeWeek = selectedWeek ?? (weekOptions[weekOptions.length - 1]?.value ?? null);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SimpleDropdown options={seasonOptions} value={selectedSeasonId} onChange={setSelectedSeasonId} />
        {weekOptions.length > 0 && activeWeek != null && (
          <SimpleDropdown
            options={weekOptions}
            value={activeWeek}
            onChange={(v) => setSelectedWeek(v)}
          />
        )}
      </div>

      {loadingGames ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : weekGames.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum jogo encontrado.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {weekGames.map((g) => {
            const home = teamMap.get(g.home_team_id);
            const away = teamMap.get(g.away_team_id);
            const homeWon = g.home_score > g.away_score;
            const awayWon = g.away_score > g.home_score;
            const tied   = g.home_score === g.away_score;
            return (
              <div key={g.id} className="rounded-lg border border-border bg-card p-3">
                <div className={cn("flex items-center justify-between gap-2", awayWon && "opacity-50")}>
                  <div className="flex items-center gap-2 min-w-0">
                    {home && <TeamLogo team={home} />}
                    <span className={cn("text-sm font-medium truncate", homeWon && "font-semibold")}>
                      {home?.name ?? "—"}
                    </span>
                  </div>
                  <span className={cn("text-sm tabular-nums font-bold shrink-0", homeWon && "text-[color:var(--court)]")}>
                    {g.home_score}
                  </span>
                </div>
                <div className="my-1.5 border-t border-border/50" />
                <div className={cn("flex items-center justify-between gap-2", homeWon && "opacity-50")}>
                  <div className="flex items-center gap-2 min-w-0">
                    {away && <TeamLogo team={away} />}
                    <span className={cn("text-sm font-medium truncate", awayWon && "font-semibold")}>
                      {away?.name ?? "—"}
                    </span>
                  </div>
                  <span className={cn("text-sm tabular-nums font-bold shrink-0", awayWon && "text-[color:var(--court)]")}>
                    {g.away_score}
                  </span>
                </div>
                {tied && (
                  <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-amber-600">Empate</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────

function HomePage() {
  const [seasons, setSeasons]                 = useState<Season[]>([]);
  const [teams, setTeams]                     = useState<TeamRow[]>([]);
  const [currentSeasonGames, setCurrentSeasonGames] = useState<GameRow[]>([]);
  const [weeksIndex, setWeeksIndex]           = useState<WeekEntry[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);
  const [defaultWeek, setDefaultWeek]         = useState<number | null>(null);
  const [activeTab, setActiveTab]             = useState<TabId>("geral");
  const [loading, setLoading]                 = useState(true);

  useEffect(() => {
    (async () => {
      // 1. Metadados: seasons + teams
      const [seasonsRes, teamsRes] = await Promise.all([
        supabase.from("seasons").select("id, label, start_year, is_current").order("start_year", { ascending: false }),
        supabase.from("teams").select("id, name, slug, conference, logo_url, primary_color, is_active"),
      ]);

      const fetchedSeasons = (seasonsRes.data ?? []) as Season[];
      const current = fetchedSeasons.find((s) => s.is_current) ?? fetchedSeasons[0];
      setSeasons(fetchedSeasons);
      setTeams((teamsRes.data as TeamRow[]) ?? []);
      setCurrentSeasonId(current?.id ?? null);

      if (!current) { setLoading(false); return; }

      // 2. Jogos da temporada atual (para classificação) — só 468 linhas
      const { data: currentGamesData } = await supabase
        .from("games")
        .select("id, home_team_id, away_team_id, home_score, away_score, week_number, season_id")
        .eq("season_id", current.id)
        .eq("is_playoff", false);

      setCurrentSeasonGames((currentGamesData as GameRow[]) ?? []);

      // 3. Índice de semanas via RPC (retorna só distintos, sem limite de rows)
      const { data: weeksData } = await supabase.rpc("get_weeks_index");

      const weeks = (weeksData ?? []) as WeekEntry[];
      setWeeksIndex(weeks);

      // Default week: última semana da temporada atual
      const currentWeeks = weeks
        .filter((w) => w.season_id === current.id)
        .map((w) => w.week_number)
        .sort((a, b) => a - b);
      const lastWeek = currentWeeks[currentWeeks.length - 1] ?? null;
      setDefaultWeek(lastWeek);

      setLoading(false);
    })();
  }, []);

  const teamMap = useMemo(() => {
    const m = new Map<string, TeamRow>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const allStandings     = useMemo(() => buildStandings(teams, currentSeasonGames), [teams, currentSeasonGames]);
  const donutStandings   = useMemo(() => buildStandings(teams.filter((t) => t.conference === "Donut"), currentSeasonGames), [teams, currentSeasonGames]);
  const badboysStandings = useMemo(() => buildStandings(teams.filter((t) => t.conference === "Bad Boys"), currentSeasonGames), [teams, currentSeasonGames]);

  const currentStandings =
    activeTab === "geral"   ? allStandings :
    activeTab === "donut"   ? donutStandings :
    badboysStandings;

  const tabs: { id: TabId; label: string }[] = [
    { id: "geral",   label: "Geral" },
    { id: "donut",   label: "Donut" },
    { id: "badboys", label: "Bad Boys" },
  ];

  const currentSeason = seasons.find((s) => s.is_current);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16 space-y-14">

      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
          Liga Bola Presa Fantasy
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">
          Temporada {currentSeason?.label ?? "—"}
        </h1>
      </div>

      {/* Jogos */}
      <section>
        <h2 className="mb-4 font-display text-2xl tracking-tight">Jogos</h2>
        {loading || !currentSeasonId ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <GamesSection
            seasons={seasons}
            weeksIndex={weeksIndex}
            teamMap={teamMap}
            defaultSeasonId={currentSeasonId}
            defaultWeek={defaultWeek}
          />
        )}
      </section>

      {/* Atalhos */}
      <section>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {shortcuts.map(({ to, label, desc, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-2 bg-card p-4 transition-colors hover:bg-accent"
            >
              <Icon className="h-4 w-4 text-[color:var(--court)]" />
              <div>
                <p className="font-medium text-sm">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-tight">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Classificação */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl tracking-tight">Classificação</h2>
          <Link to="/classificacao" className="inline-flex items-center gap-1 text-sm text-[color:var(--court)] hover:underline">
            Ver completa <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mb-3 flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-48 rounded-lg bg-muted animate-pulse" />
        ) : (
          <StandingsMini entries={currentStandings} />
        )}
      </section>

    </div>
  );
}
