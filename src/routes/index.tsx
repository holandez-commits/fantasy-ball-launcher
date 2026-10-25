import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import { serverClient, placaresAoVivo, type LivePlacar } from "@/lib/confronto-server";
import {
  ArrowUpRight, Trophy, Users, CalendarDays, ClipboardList,
  BarChart2, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildStandings,
  StandingsTable,
  type StandingsTeam,
  type StandingsGame,
  type StandingsRow,
} from "@/components/standings-table";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = { id: string; label: string; start_year: number; is_current: boolean };

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  week_number: number | null;
  game_number_in_week: number | null;
  game_code: string | null;
  status: string;
  season_id: string;
  external_url: string | null;
};

type WeekEntry = { season_id: string; week_number: number };

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
  { to: "/escalar",    label: "Escalar",    desc: "Monte sua escalação",       icon: ClipboardList },
  { to: "/calendario", label: "Calendário", desc: "Próximas rodadas",          icon: CalendarDays },
] as const;

// Placar ao vivo dos cards (Fase 2): lê as planilhas dos jogos scheduled no servidor.
const placaresFn = createServerFn({ method: "POST" })
  .inputValidator((gameIds: string[]) => gameIds)
  .handler(async ({ data }): Promise<LivePlacar[]> => placaresAoVivo(serverClient(), data));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ─── TeamLogo (compacto, usado nos cards de jogos) ─────────────────────────────

function TeamLogo({ team }: { team: StandingsTeam | undefined }) {
  const bg = team?.primary_color ?? "#374151";
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shrink-0"
      style={{ background: bg }}
    >
      {team?.logo_url
        ? <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
        : <span>{team ? teamInitials(team.name) : "—"}</span>
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
  teamMap: Map<string, StandingsTeam>;
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

  // Quando muda de temporada, vai para a primeira semana dessa temporada
  useEffect(() => {
    if (weekOptions.length > 0) {
      setSelectedWeek(weekOptions[0].value);
    }
  }, [selectedSeasonId]);

  // placar ao vivo por jogo (gid -> placar lido da planilha)
  const [live, setLive] = useState<Map<string, LivePlacar>>(new Map());

  // Busca jogos da semana selecionada sob demanda
  useEffect(() => {
    if (!selectedSeasonId || selectedWeek == null) return;

    setLoadingGames(true);
    setLive(new Map());
    supabase
      .from("games")
      .select("id, home_team_id, away_team_id, home_score, away_score, week_number, game_number_in_week, game_code, status, season_id, external_url")
      .eq("season_id", selectedSeasonId)
      .eq("week_number", selectedWeek)
      .eq("is_playoff", false)
      .order("game_number_in_week" as "week_number", { ascending: true })
      .then(({ data }) => {
        setWeekGames((data as unknown as GameRow[]) ?? []);
        setLoadingGames(false);
      });
  }, [selectedSeasonId, selectedWeek]);

  // Placar ao vivo dos jogos ainda não finais que têm planilha (load + polling 60s).
  useEffect(() => {
    const ids = weekGames.filter((g) => g.status !== "final" && g.external_url).map((g) => g.id);
    if (ids.length === 0) return;
    let alive = true;
    async function load() {
      try {
        const res = await placaresFn({ data: ids });
        if (!alive) return;
        setLive((prev) => {
          const m = new Map(prev);
          for (const r of res) if (r.ok) m.set(r.gameId, r);
          return m;
        });
      } catch {
        /* mantém o que tinha */
      }
    }
    load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [weekGames]);

  // Não lista temporadas futuras (posteriores à corrente) no seletor.
  const currentStart = seasons.find((s) => s.id === defaultSeasonId)?.start_year ?? Infinity;
  const seasonOptions = seasons
    .filter((s) => s.start_year <= currentStart)
    .map((s) => ({ value: s.id, label: `Temporada ${s.label}` }));
  const activeWeek = selectedWeek ?? (weekOptions[0]?.value ?? null);

  // Agrupa por rodada (game_number_in_week) — cada semana pode ter 1 a 3 rodadas.
  const rodadas = useMemo(() => {
    const m = new Map<number, GameRow[]>();
    for (const g of weekGames) {
      const k = g.game_number_in_week ?? 1;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [weekGames]);

  const multiplasRodadas = rodadas.length > 1;

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
        <div className="space-y-6">
          {rodadas.map(([rod, gs]) => (
            <div key={rod}>
              {multiplasRodadas && (
                <div className="mb-2.5 flex items-center gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--court)]">
                    Rodada {rod}
                  </h3>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {gs.map((g) => (
                  <GameCard key={g.id} g={g} teamMap={teamMap} live={live.get(g.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GameCard (placar do banco quando final; ao vivo da planilha senão) ─────────

function GameCard({
  g,
  teamMap,
  live,
}: {
  g: GameRow;
  teamMap: Map<string, StandingsTeam>;
  live: LivePlacar | undefined;
}) {
  const home = teamMap.get(g.home_team_id);
  const away = teamMap.get(g.away_team_id);
  const isFinal = g.status === "final";
  const hasLive = !isFinal && !!live && live.ok;

  const hs = isFinal ? g.home_score : hasLive ? live!.homeScore! : null;
  const as = isFinal ? g.away_score : hasLive ? live!.awayScore! : null;
  const hasScore = hs != null && as != null;
  const homeWon = hasScore && hs! > as!;
  const awayWon = hasScore && as! > hs!;
  const tied = hasScore && hs! === as!;

  const inner = (
    <>
      <div className={cn("flex items-center justify-between gap-2", awayWon && "opacity-50")}>
        <div className="flex items-center gap-2 min-w-0">
          {home && <TeamLogo team={home} />}
          <span className={cn("text-sm font-medium truncate", homeWon && "font-semibold")}>{home?.name ?? "—"}</span>
        </div>
        <span className={cn("text-sm tabular-nums font-bold shrink-0", homeWon && "text-[color:var(--court)]")}>
          {hasScore ? hs : ""}
        </span>
      </div>
      <div className="my-1.5 border-t border-border/50" />
      <div className={cn("flex items-center justify-between gap-2", homeWon && "opacity-50")}>
        <div className="flex items-center gap-2 min-w-0">
          {away && <TeamLogo team={away} />}
          <span className={cn("text-sm font-medium truncate", awayWon && "font-semibold")}>{away?.name ?? "—"}</span>
        </div>
        <span className={cn("text-sm tabular-nums font-bold shrink-0", awayWon && "text-[color:var(--court)]")}>
          {hasScore ? as : ""}
        </span>
      </div>
      {isFinal ? (
        tied ? (
          <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-amber-600">Empate</p>
        ) : null
      ) : hasLive ? (
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Ao vivo
        </p>
      ) : (
        <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">A jogar</p>
      )}
    </>
  );

  return g.external_url ? (
    <Link
      to="/confronto/$gameId"
      params={{ gameId: g.id }}
      title="Ver confronto ao vivo"
      className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-[color:var(--court)] hover:bg-accent"
    >
      {inner}
    </Link>
  ) : (
    <div className="rounded-lg border border-border bg-card p-3">{inner}</div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────

function HomePage() {
  const [seasons, setSeasons]                 = useState<Season[]>([]);
  const [teams, setTeams]                     = useState<StandingsTeam[]>([]);
  const [currentSeasonGames, setCurrentSeasonGames] = useState<StandingsGame[]>([]);
  const [standingsData, setStandingsData]     = useState<StandingsRow[]>([]);
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
        supabase.from("teams").select("id, name, slug, conference, is_active, logo_url, primary_color, gm:gms(full_name)"),
      ]);

      const fetchedSeasons = (seasonsRes.data ?? []) as Season[];
      // Padrão: temporada corrente (mesmo sem jogos ainda).
      const current = fetchedSeasons.find((s) => s.is_current) ?? fetchedSeasons[0];
      setSeasons(fetchedSeasons);
      setTeams((teamsRes.data as unknown as StandingsTeam[]) ?? []);
      setCurrentSeasonId(current?.id ?? null);

      if (!current) { setLoading(false); return; }

      // 2. Jogos finalizados da temporada atual + standings via RPC (para a tabela)
      const [currentGamesRes, standingsRes] = await Promise.all([
        supabase
          .from("games")
          .select("id, home_team_id, away_team_id, home_score, away_score, week_number, game_number_in_week")
          .eq("season_id", current.id)
          .eq("is_playoff", false)
          .eq("status" as "id", "final"),
        supabase.rpc("get_standings", { season_ids: [current.id] }),
      ]);

      setCurrentSeasonGames((currentGamesRes.data as StandingsGame[]) ?? []);
      setStandingsData((standingsRes.data as StandingsRow[]) ?? []);

      // 3. Índice de semanas via RPC (retorna só distintos, sem limite de rows)
      const { data: weeksData } = await supabase.rpc("get_weeks_index");

      const weeks = (weeksData ?? []) as WeekEntry[];
      setWeeksIndex(weeks);

      // Default week: primeira semana da temporada atual
      const currentWeeks = weeks
        .filter((w) => w.season_id === current.id)
        .map((w) => w.week_number)
        .sort((a, b) => a - b);
      const firstWeek = currentWeeks[0] ?? null;
      setDefaultWeek(firstWeek);

      setLoading(false);
    })();
  }, []);

  const teamMap = useMemo(() => {
    const m = new Map<string, StandingsTeam>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const standingsMap = useMemo(() => {
    const m = new Map<string, StandingsRow>();
    for (const r of standingsData) m.set(r.team_id, r);
    return m;
  }, [standingsData]);

  // Na home a classificação é da temporada atual: times extintos ficam de fora.
  // (teams completo continua em teamMap, usado nos jogos da semana.)
  const activeTeams = useMemo(() => teams.filter((t) => t.is_active), [teams]);

  const allStandings     = useMemo(() => buildStandings(activeTeams, currentSeasonGames, true, standingsMap), [activeTeams, currentSeasonGames, standingsMap]);
  const donutStandings   = useMemo(() => buildStandings(activeTeams.filter((t) => t.conference === "Donut"), currentSeasonGames, true, standingsMap), [activeTeams, currentSeasonGames, standingsMap]);
  const badboysStandings = useMemo(() => buildStandings(activeTeams.filter((t) => t.conference === "Bad Boys"), currentSeasonGames, true, standingsMap), [activeTeams, currentSeasonGames, standingsMap]);

  const currentStandings =
    activeTab === "geral"   ? allStandings :
    activeTab === "donut"   ? donutStandings :
    badboysStandings;

  const tabs: { id: TabId; label: string }[] = [
    { id: "geral",   label: "Geral" },
    { id: "donut",   label: "Donut" },
    { id: "badboys", label: "Bad Boys" },
  ];

  const currentSeason = seasons.find((s) => s.id === currentSeasonId);

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
          <StandingsTable
            entries={currentStandings}
            showPlayoffCutoff={activeTab !== "geral"}
            showStreakAndL5={true}
          />
        )}
      </section>

    </div>
  );
}
