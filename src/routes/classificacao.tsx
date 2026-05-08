import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = {
  id: string;
  label: string;
  start_year: number;
  end_year: number;
  is_current: boolean;
  is_completed: boolean;
};

type TeamRow = {
  id: string;
  name: string;
  slug: string;
  conference: string | null;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
  gm: { full_name: string } | null;
};

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  week_number: number | null;
  game_number_in_week: number;
};

type GameResult = "W" | "L" | "D";

type StandingEntry = {
  team: TeamRow;
  w: number;
  d: number;
  l: number;
  gp: number;
  pct: number;
  streak: { type: GameResult; count: number } | null;
  last5: { w: number; l: number; d: number } | null;
};

type TabId = "geral" | "donut" | "badboys";

type StandingsRow = {
  team_id: string;
  w: number;
  d: number;
  l: number;
  gp: number;
};

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/classificacao")({
  head: () => ({
    meta: [
      { title: "Classificação — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Classificação da Liga Bola Presa." },
    ],
  }),
  component: ClassificacaoPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna o resultado de um jogo para um dado time.
 */
function gameResultForTeam(g: GameRow, teamId: string): GameResult {
  const isHome = g.home_team_id === teamId;
  const myScore = isHome ? g.home_score : g.away_score;
  const oppScore = isHome ? g.away_score : g.home_score;
  if (myScore > oppScore) return "W";
  if (myScore < oppScore) return "L";
  return "D";
}

/**
 * Ordena jogos do mais recente para o mais antigo.
 * Critério: week_number desc, game_number_in_week desc.
 * Jogos com week_number null vão para o final.
 */
function sortGamesDesc(games: GameRow[]): GameRow[] {
  return [...games].sort((a, b) => {
    const wa = a.week_number ?? -1;
    const wb = b.week_number ?? -1;
    if (wb !== wa) return wb - wa;
    return b.game_number_in_week - a.game_number_in_week;
  });
}

function buildStandings(teams: TeamRow[], games: GameRow[], singleSeason: boolean, standingsMap?: Map<string, StandingsRow>): StandingEntry[] {
  const map = new Map<string, { w: number; d: number; l: number }>();
  const teamGames = new Map<string, GameRow[]>();

  for (const t of teams) {
    // Use standingsMap (RPC) when available, fallback to counting from games
    const rpc = standingsMap?.get(t.id);
    map.set(t.id, rpc ? { w: Number(rpc.w), d: Number(rpc.d), l: Number(rpc.l) } : { w: 0, d: 0, l: 0 });
    teamGames.set(t.id, []);
  }

  // Still iterate games for streak/L5 calculation
  for (const g of games) {
    if (!standingsMap) {
      // Fallback: calculate W/D/L from games when no RPC data
      const home = map.get(g.home_team_id);
      const away = map.get(g.away_team_id);
      if (g.home_score > g.away_score) {
        if (home) home.w++;
        if (away) away.l++;
      } else if (g.away_score > g.home_score) {
        if (away) away.w++;
        if (home) home.l++;
      } else {
        if (home) home.d++;
        if (away) away.d++;
      }
    }
    if (teamGames.has(g.home_team_id)) teamGames.get(g.home_team_id)!.push(g);
    if (teamGames.has(g.away_team_id)) teamGames.get(g.away_team_id)!.push(g);
  }

  return teams
    .map((team) => {
      const rec = map.get(team.id) ?? { w: 0, d: 0, l: 0 };
      const rpcRow = standingsMap?.get(team.id);
      const gp = rpcRow ? Number(rpcRow.gp) : rec.w + rec.d + rec.l;

      let streak: StandingEntry["streak"] = null;
      let last5: StandingEntry["last5"] = null;

      if (singleSeason) {
        const sorted = sortGamesDesc(teamGames.get(team.id) ?? []);

        // Streak
        if (sorted.length > 0) {
          const firstResult = gameResultForTeam(sorted[0], team.id);
          let count = 1;
          for (let i = 1; i < sorted.length; i++) {
            if (gameResultForTeam(sorted[i], team.id) === firstResult) {
              count++;
            } else {
              break;
            }
          }
          streak = { type: firstResult, count };
        }

        // L5
        const last5Games = sorted.slice(0, 5);
        if (last5Games.length > 0) {
          const l5 = { w: 0, l: 0, d: 0 };
          for (const g of last5Games) {
            const r = gameResultForTeam(g, team.id);
            if (r === "W") l5.w++;
            else if (r === "L") l5.l++;
            else l5.d++;
          }
          last5 = l5;
        }
      }

      return {
        team,
        ...rec,
        gp,
        pct: gp > 0 ? rec.w / gp : 0,
        streak,
        last5,
      };
    })
    .sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;
      if (b.d !== a.d) return b.d - a.d;
      return a.team.name.localeCompare(b.team.name);
    });
}

function pctStr(pct: number) {
  return pct.toFixed(3).replace(/^0/, "");
}

/** Cor condicional para a coluna PCT */
function pctColor(pct: number): string {
  if (pct >= 0.65) return "text-purple-600 dark:text-purple-400";
  if (pct >= 0.5)  return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 0.35) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Iniciais do time para fallback de logo (máx 2 letras) */
function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ─── Team logo ────────────────────────────────────────────────────────────────

function TeamLogo({ team }: { team: TeamRow }) {
  const bg = team.primary_color ?? "var(--muted)";
  return (
    <div
      className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-white shrink-0"
      style={{ background: bg }}
    >
      {team.logo_url ? (
        <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
      ) : (
        <span>{teamInitials(team.name)}</span>
      )}
    </div>
  );
}

// ─── Streak badge ─────────────────────────────────────────────────────────────

function StreakBadge({ streak }: { streak: StandingEntry["streak"] }) {
  if (!streak) return <span className="text-muted-foreground">—</span>;

  const colorClass =
    streak.type === "W"
      ? "text-emerald-600 dark:text-emerald-400"
      : streak.type === "L"
      ? "text-red-600 dark:text-red-400"
      : "text-amber-600 dark:text-amber-400";

  return (
    <span className={cn("font-medium tabular-nums", colorClass)}>
      {streak.count}{streak.type}
    </span>
  );
}

// ─── L5 badge ────────────────────────────────────────────────────────────────

function L5Badge({ last5 }: { last5: StandingEntry["last5"] }) {
  if (!last5) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums text-muted-foreground">
      {last5.w}-{last5.l}-{last5.d}
    </span>
  );
}

// ─── Season selector ──────────────────────────────────────────────────────────

function SeasonSelector({
  seasons,
  selected,
  onChange,
}: {
  seasons: Season[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    if (selected.size === 0) return "Nenhuma temporada";
    if (selected.size === seasons.length) return "Todas as temporadas";
    const sorted = seasons.filter((s) => selected.has(s.id)).map((s) => s.label);
    return sorted.join(", ");
  }, [selected, seasons]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function selectAll() { onChange(new Set(seasons.map((s) => s.id))); }

  function selectCurrent() {
    const current = seasons.find((s) => s.is_current) ?? seasons[0];
    if (current) onChange(new Set([current.id]));
  }

  function selectLast() {
    const last = seasons.find((s) => s.is_completed && !s.is_current) ?? seasons[0];
    if (last) onChange(new Set([last.id]));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        <span className="max-w-[280px] truncate">{label}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-md">
            <div className="flex gap-1 border-b border-border p-2">
              <button type="button" onClick={() => { selectAll(); setOpen(false); }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                Todas
              </button>
              <button type="button" onClick={() => { selectCurrent(); setOpen(false); }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                Atual
              </button>
              <button type="button" onClick={() => { selectLast(); setOpen(false); }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                Última
              </button>
            </div>

            <ul className="py-1">
              {seasons.map((s) => {
                const checked = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => toggle(s.id)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                      <span className={cn(
                        "flex h-4 w-4 flex-none items-center justify-center rounded border",
                        checked ? "border-[color:var(--court)] bg-[color:var(--court)]" : "border-border bg-background"
                      )}>
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="flex-1 text-left">Temporada {s.label}</span>
                      {s.is_current && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--court)]">
                          atual
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Standings table ──────────────────────────────────────────────────────────

const PLAYOFF_CUTOFF = 8;

function StandingsTable({
  entries,
  showPlayoffCutoff,
  showStreakAndL5,
}: {
  entries: StandingEntry[];
  showPlayoffCutoff: boolean;
  showStreakAndL5: boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum dado encontrado.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 w-8">#</th>
            <th className="w-10 py-3 pl-2 pr-0" />
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3 hidden sm:table-cell font-normal text-muted-foreground/70">GM</th>
            <th className="px-4 py-3 text-right">V</th>
            <th className="px-4 py-3 text-right">E</th>
            <th className="px-4 py-3 text-right">D</th>
            <th className="px-4 py-3 text-right">PCT</th>
            {showStreakAndL5 && (
              <>
                <th className="px-4 py-3 text-right hidden md:table-cell">Seq</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">L5</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const inactive = !entry.team.is_active;
            const isPlayoffCutoff = showPlayoffCutoff && i === PLAYOFF_CUTOFF - 1;

            return (
              <tr
                key={entry.team.id}
                className={cn(
                  "transition-colors hover:bg-muted/40",
                  isPlayoffCutoff
                    ? "border-b-2 border-b-[color:var(--court)]/40"
                    : "border-b border-border/60 last:border-0",
                  i % 2 === 1 ? "bg-muted/10" : "",
                  inactive ? "opacity-60" : ""
                )}
              >
                <td className="px-4 py-3 font-display text-base text-muted-foreground tabular-nums">
                  {i + 1}
                </td>

                <td className="py-3 pl-2 pr-0">
                  <TeamLogo team={entry.team} />
                </td>

                <td className="px-4 py-3">
                  <Link
                    to="/times/$slug"
                    params={{ slug: entry.team.slug }}
                    className={cn(
                      "font-medium hover:underline",
                      inactive
                        ? "text-muted-foreground"
                        : "text-foreground hover:text-[color:var(--court)]"
                    )}
                  >
                    {entry.team.name}
                  </Link>
                  {inactive && (
                    <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                      extinto
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground">
                  {entry.team.gm?.full_name ?? "—"}
                </td>

                <td className="px-4 py-3 text-right tabular-nums font-medium">{entry.w}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.d}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.l}</td>

                <td className={cn("px-4 py-3 text-right tabular-nums font-medium", pctColor(entry.pct))}>
                  {pctStr(entry.pct)}
                </td>

                {showStreakAndL5 && (
                  <>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <StreakBadge streak={entry.streak} />
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <L5Badge last5={entry.last5} />
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ClassificacaoPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [standingsData, setStandingsData] = useState<StandingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("geral");

  useEffect(() => {
    (async () => {
      const [seasonsRes, teamsRes] = await Promise.all([
        supabase
          .from("seasons")
          .select("id, label, start_year, end_year, is_current, is_completed")
          .order("start_year", { ascending: false }),
        supabase
          .from("teams")
          .select("id, name, slug, conference, is_active, logo_url, primary_color, gm:gms(full_name)"),
      ]);

      if (seasonsRes.error) { setError(seasonsRes.error.message); setLoading(false); return; }
      if (teamsRes.error)   { setError(teamsRes.error.message);   setLoading(false); return; }

      const fetchedSeasons = (seasonsRes.data ?? []) as Season[];
      setSeasons(fetchedSeasons);
      setTeams((teamsRes.data as unknown as TeamRow[]) ?? []);

      const defaultSeason =
        fetchedSeasons.find((s) => s.is_current) ??
        fetchedSeasons.find((s) => s.is_completed) ??
        fetchedSeasons[0];

      if (defaultSeason) setSelectedSeasons(new Set([defaultSeason.id]));
    })();
  }, []);

  useEffect(() => {
    if (selectedSeasons.size === 0) { setGames([]); setStandingsData([]); setLoading(false); return; }

    setLoading(true);
    const ids = Array.from(selectedSeasons);

    // Sempre busca standings via RPC (sem limite de rows)
    const standingsPromise = supabase.rpc("get_standings", { season_ids: ids });

    // Busca jogos completos só quando uma temporada selecionada (para streak/L5)
    const gamesPromise = selectedSeasons.size === 1
      ? supabase
          .from("games")
          .select("id, home_team_id, away_team_id, home_score, away_score, week_number, game_number_in_week")
          .in("season_id", ids)
          .eq("is_playoff", false)
      : Promise.resolve({ data: [], error: null });

    Promise.all([standingsPromise, gamesPromise]).then(([standingsRes, gamesRes]) => {
      if (standingsRes.error) setError(standingsRes.error.message);
      else setStandingsData((standingsRes.data as StandingsRow[]) ?? []);
      if (!gamesRes.error) setGames((gamesRes.data as GameRow[]) ?? []);
      setLoading(false);
    });
  }, [selectedSeasons]);

  // Streak e L5 só fazem sentido com uma única temporada selecionada
  const singleSeason = selectedSeasons.size === 1;

  // Mapa de standings do RPC
  const standingsMap = useMemo(() => {
    const m = new Map<string, StandingsRow>();
    for (const r of standingsData) m.set(r.team_id, r);
    return m;
  }, [standingsData]);

  const allStandings = useMemo(
    () => buildStandings(teams, games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap]
  );

  const donutStandings = useMemo(
    () => buildStandings(teams.filter((t) => t.conference === "Donut"), games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap]
  );

  const badboysStandings = useMemo(
    () => buildStandings(teams.filter((t) => t.conference === "Bad Boys"), games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap]
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: "geral", label: "Geral" },
    { id: "donut", label: "Donut" },
    { id: "badboys", label: "Bad Boys" },
  ];

  const currentStandings =
    activeTab === "geral" ? allStandings :
    activeTab === "donut" ? donutStandings :
    badboysStandings;

  const showPlayoffCutoff = activeTab !== "geral";

  const seasonLabel = useMemo(() => {
    if (selectedSeasons.size === 0) return "";
    if (selectedSeasons.size === seasons.length) return "Todas as temporadas";
    if (selectedSeasons.size === 1) {
      const s = seasons.find((s) => selectedSeasons.has(s.id));
      return s ? `Temporada ${s.label}` : "";
    }
    const labels = seasons.filter((s) => selectedSeasons.has(s.id)).map((s) => s.label);
    return `Temporadas ${labels.join(", ")}`;
  }, [selectedSeasons, seasons]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
          Liga Bola Presa
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">
          Classificação
        </h1>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SeasonSelector seasons={seasons} selected={selectedSeasons} onChange={setSelectedSeasons} />
        {seasonLabel && <span className="text-sm text-muted-foreground">{seasonLabel}</span>}
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showPlayoffCutoff && !loading && (
        <p className="mb-2 text-xs text-muted-foreground">
          Linha separa zona de playoffs (top 8).
        </p>
      )}

      {error && <p className="mb-4 text-sm text-destructive">Erro: {error}</p>}

      {loading ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="animate-pulse space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-4 rounded bg-muted" />
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-4 flex-1 rounded bg-muted" />
                <div className="h-4 w-8 rounded bg-muted" />
                <div className="h-4 w-8 rounded bg-muted" />
                <div className="h-4 w-8 rounded bg-muted" />
                <div className="h-4 w-12 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <StandingsTable
          entries={currentStandings}
          showPlayoffCutoff={showPlayoffCutoff}
          showStreakAndL5={singleSeason}
        />
      )}

      {!loading && allStandings.some((e) => !e.team.is_active) && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
            extinto
          </span>
          Time que não compete mais na liga.
        </p>
      )}
    </div>
  );
}
