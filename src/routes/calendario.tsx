import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../integrations/supabase/client";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = { id: string; label: string; start_year: number; is_current: boolean };

type TeamRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
};

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  week_number: number | null;
  game_number_in_week: number;
  external_url: string | null;
};

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Calendário de jogos da temporada da Liga Bola Presa." },
    ],
  }),
  component: CalendarioPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function TeamLogo({ team }: { team: TeamRow | undefined }) {
  const bg = team?.primary_color ?? "#374151";
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shrink-0"
      style={{ background: bg }}
    >
      {team?.logo_url ? (
        <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
      ) : (
        <span>{team ? teamInitials(team.name) : "—"}</span>
      )}
    </div>
  );
}

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
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
            <ul className="py-1">
              {options.map((opt) => (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                      opt.value === value && "font-medium text-[color:var(--court)]",
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

// ─── Game card ────────────────────────────────────────────────────────────────

function GameCard({ g, teamMap }: { g: GameRow; teamMap: Map<string, TeamRow> }) {
  const home = teamMap.get(g.home_team_id);
  const away = teamMap.get(g.away_team_id);
  const hasScore = g.home_score != null && g.away_score != null;
  const homeWon = hasScore && g.home_score! > g.away_score!;
  const awayWon = hasScore && g.away_score! > g.home_score!;
  const tied = hasScore && g.home_score! === g.away_score!;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        hasScore &&
          "border-emerald-500/50 border-l-4 border-l-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700/60",
      )}
    >
      <div className={cn("flex items-center justify-between gap-2", awayWon && "opacity-50")}>
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo team={home} />
          {home ? (
            <Link
              to="/times/$slug"
              params={{ slug: home.slug }}
              className={cn("text-sm font-medium truncate hover:underline", homeWon && "font-semibold")}
            >
              {home.name}
            </Link>
          ) : (
            <span className="text-sm font-medium truncate">—</span>
          )}
        </div>
        <span className={cn("text-sm tabular-nums font-bold shrink-0", homeWon && "text-[color:var(--court)]")}>
          {hasScore ? g.home_score : ""}
        </span>
      </div>
      <div className="my-1.5 border-t border-border/50" />
      <div className={cn("flex items-center justify-between gap-2", homeWon && "opacity-50")}>
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo team={away} />
          {away ? (
            <Link
              to="/times/$slug"
              params={{ slug: away.slug }}
              className={cn("text-sm font-medium truncate hover:underline", awayWon && "font-semibold")}
            >
              {away.name}
            </Link>
          ) : (
            <span className="text-sm font-medium truncate">—</span>
          )}
        </div>
        <span className={cn("text-sm tabular-nums font-bold shrink-0", awayWon && "text-[color:var(--court)]")}>
          {hasScore ? g.away_score : ""}
        </span>
      </div>
      {!hasScore && (
        <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">A jogar</p>
      )}
      {hasScore && (
        <p className="mt-1.5 flex items-center justify-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            ✓ Concluída
          </span>
          {tied && <span className="text-[10px] font-normal uppercase tracking-wide text-amber-600">· Empate</span>}
        </p>
      )}
      {g.external_url && (
        <Link
          to="/confronto/$gameId"
          params={{ gameId: g.id }}
          className="mt-2 block border-t border-border/50 pt-2 text-center text-[11px] font-medium text-muted-foreground hover:text-[color:var(--court)] hover:underline"
        >
          Ver partida →
        </Link>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const ALL = "__all";

function CalendarioPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [seasonId, setSeasonId] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>(ALL);
  const [weekFilter, setWeekFilter] = useState<number | typeof ALL>(ALL);
  const [loading, setLoading] = useState(true);
  const [loadingGames, setLoadingGames] = useState(false);

  // Metadados: temporadas (sem as futuras) + times.
  useEffect(() => {
    (async () => {
      const [seasonsRes, teamsRes] = await Promise.all([
        supabase
          .from("seasons")
          .select("id, label, start_year, is_current")
          .order("start_year", { ascending: false }),
        supabase.from("teams").select("id, name, slug, is_active, logo_url, primary_color"),
      ]);
      const allSeasons = (seasonsRes.data ?? []) as Season[];
      const current = allSeasons.find((s) => s.is_current) ?? allSeasons[0];
      const currentStart = current?.start_year ?? Infinity;
      const visible = allSeasons.filter((s) => s.start_year <= currentStart);
      setSeasons(visible);
      setTeams((teamsRes.data as TeamRow[]) ?? []);
      setSeasonId(current?.id ?? visible[0]?.id ?? "");
      setLoading(false);
    })();
  }, []);

  // Jogos da temporada selecionada.
  useEffect(() => {
    if (!seasonId) return;
    setLoadingGames(true);
    setTeamFilter(ALL);
    setWeekFilter(ALL);
    supabase
      .from("games")
      .select("id, home_team_id, away_team_id, home_score, away_score, week_number, game_number_in_week, external_url")
      .eq("season_id", seasonId)
      .eq("is_playoff", false)
      .order("week_number", { ascending: true })
      .order("game_number_in_week", { ascending: true })
      .then(({ data }) => {
        setGames((data as unknown as GameRow[]) ?? []);
        setLoadingGames(false);
      });
  }, [seasonId]);

  const teamMap = useMemo(() => {
    const m = new Map<string, TeamRow>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const weekOptions = useMemo(() => {
    const ws = [...new Set(games.map((g) => g.week_number).filter((w): w is number => w != null))].sort(
      (a, b) => a - b,
    );
    return ws;
  }, [games]);

  // Só os 24 times ativos no filtro (o mapa segue com todos, p/ renderizar
  // jogos de temporadas antigas que envolvam times extintos).
  const teamOptions = useMemo(
    () => teams.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  const filtered = useMemo(
    () =>
      games.filter((g) => {
        if (weekFilter !== ALL && g.week_number !== weekFilter) return false;
        if (teamFilter !== ALL && g.home_team_id !== teamFilter && g.away_team_id !== teamFilter)
          return false;
        return true;
      }),
    [games, weekFilter, teamFilter],
  );

  // Agrupa: semana → rodada → jogos.
  const grouped = useMemo(() => {
    const byWeek = new Map<number, Map<number, GameRow[]>>();
    for (const g of filtered) {
      const wk = g.week_number ?? 0;
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      const rounds = byWeek.get(wk)!;
      const r = g.game_number_in_week;
      if (!rounds.has(r)) rounds.set(r, []);
      rounds.get(r)!.push(g);
    }
    return [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wk, rounds]) => ({
        week: wk,
        rounds: [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([r, gs]) => ({ round: r, games: gs })),
      }));
  }, [filtered]);

  const seasonOptions = seasons.map((s) => ({ value: s.id, label: `Temporada ${s.label}` }));
  const weekSelectOptions = [
    { value: ALL as number | typeof ALL, label: "Todas as semanas" },
    ...weekOptions.map((w) => ({ value: w as number | typeof ALL, label: `Semana ${w}` })),
  ];
  const teamSelectOptions = [
    { value: ALL, label: "Todos os times" },
    ...teamOptions.map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
          Liga Bola Presa
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">Calendário</h1>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {!loading && seasonId && (
          <SimpleDropdown options={seasonOptions} value={seasonId} onChange={setSeasonId} />
        )}
        <SimpleDropdown
          options={teamSelectOptions}
          value={teamFilter}
          onChange={setTeamFilter}
        />
        <SimpleDropdown
          options={weekSelectOptions}
          value={weekFilter}
          onChange={(v) => setWeekFilter(v)}
        />
      </div>

      {loading || loadingGames ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum jogo encontrado.</p>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ week, rounds }) => (
            <section key={week}>
              <h2 className="mb-3 font-display text-2xl tracking-tight">Semana {week}</h2>
              <div className="space-y-5">
                {rounds.map(({ round, games: gs }) => (
                  <div key={round}>
                    {rounds.length > 1 && (
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Rodada {round}
                      </p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {gs.map((g) => (
                        <GameCard key={g.id} g={g} teamMap={teamMap} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
