import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StandingsTeam = {
  id: string;
  name: string;
  slug: string;
  conference: string | null;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
  gm: { full_name: string } | null;
};

export type StandingsGame = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  week_number: number | null;
  game_number_in_week: number;
};

export type GameResult = "W" | "L" | "D";

export type StandingEntry = {
  team: StandingsTeam;
  w: number;
  d: number;
  l: number;
  gp: number;
  pct: number;
  streak: { type: GameResult; count: number } | null;
  last5: { w: number; l: number; d: number } | null;
};

export type StandingsRow = {
  team_id: string;
  w: number;
  d: number;
  l: number;
  gp: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gameResultForTeam(g: StandingsGame, teamId: string): GameResult {
  const isHome = g.home_team_id === teamId;
  const myScore = (isHome ? g.home_score : g.away_score) ?? 0;
  const oppScore = (isHome ? g.away_score : g.home_score) ?? 0;
  if (myScore > oppScore) return "W";
  if (myScore < oppScore) return "L";
  return "D";
}

/**
 * Ordena jogos do mais recente para o mais antigo.
 * Critério: week_number desc, game_number_in_week desc.
 */
function sortGamesDesc(games: StandingsGame[]): StandingsGame[] {
  return [...games].sort((a, b) => {
    const wa = a.week_number ?? -1;
    const wb = b.week_number ?? -1;
    if (wb !== wa) return wb - wa;
    return b.game_number_in_week - a.game_number_in_week;
  });
}

export function buildStandings(
  teams: StandingsTeam[],
  games: StandingsGame[],
  singleSeason: boolean,
  standingsMap?: Map<string, StandingsRow>,
): StandingEntry[] {
  const map = new Map<string, { w: number; d: number; l: number }>();
  const teamGames = new Map<string, StandingsGame[]>();

  for (const t of teams) {
    const rpc = standingsMap?.get(t.id);
    map.set(t.id, rpc ? { w: Number(rpc.w), d: Number(rpc.d), l: Number(rpc.l) } : { w: 0, d: 0, l: 0 });
    teamGames.set(t.id, []);
  }

  for (const g of games) {
    if (!standingsMap) {
      const home = map.get(g.home_team_id);
      const away = map.get(g.away_team_id);
      if (g.home_score == null || g.away_score == null) {
        // jogo sem placar não conta
      } else if (g.home_score > g.away_score) {
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
        // só jogos COM placar entram em Seq/L5
        const sorted = sortGamesDesc(
          (teamGames.get(team.id) ?? []).filter((g) => g.home_score != null && g.away_score != null),
        );

        if (sorted.length > 0) {
          const firstResult = gameResultForTeam(sorted[0], team.id);
          let count = 1;
          for (let i = 1; i < sorted.length; i++) {
            if (gameResultForTeam(sorted[i], team.id) === firstResult) count++;
            else break;
          }
          streak = { type: firstResult, count };
        }

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
      // Times extintos sempre no fim da tabela.
      if (a.team.is_active !== b.team.is_active) return a.team.is_active ? -1 : 1;
      if (b.w !== a.w) return b.w - a.w;
      if (b.d !== a.d) return b.d - a.d;
      return a.team.name.localeCompare(b.team.name);
    });
}

function pctStr(pct: number) {
  return pct.toFixed(3).replace(/^0/, "");
}

function pctColor(pct: number): string {
  if (pct >= 0.65) return "text-purple-600 dark:text-purple-400";
  if (pct >= 0.5) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 0.35) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function TeamLogo({ team }: { team: StandingsTeam }) {
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
      {streak.count}
      {streak.type}
    </span>
  );
}

function L5Badge({ last5 }: { last5: StandingEntry["last5"] }) {
  if (!last5) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums text-muted-foreground">
      {last5.w}-{last5.l}-{last5.d}
    </span>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

const PLAYOFF_CUTOFF = 8;

export function StandingsTable({
  entries,
  showPlayoffCutoff,
  showStreakAndL5,
}: {
  entries: StandingEntry[];
  showPlayoffCutoff: boolean;
  showStreakAndL5: boolean;
}) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum dado encontrado.</p>;
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
                  inactive ? "opacity-60" : "",
                )}
              >
                <td className="px-4 py-3 font-display text-base text-muted-foreground tabular-nums">{i + 1}</td>

                <td className="py-3 pl-2 pr-0">
                  <TeamLogo team={entry.team} />
                </td>

                <td className="px-4 py-3">
                  <Link
                    to="/times/$slug"
                    params={{ slug: entry.team.slug }}
                    className={cn(
                      "font-medium hover:underline",
                      inactive ? "text-muted-foreground" : "text-foreground hover:text-[color:var(--court)]",
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
