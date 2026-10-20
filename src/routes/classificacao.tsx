import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildStandings,
  StandingsTable,
  type StandingsTeam,
  type StandingsGame,
  type StandingsRow,
} from "@/components/standings-table";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = {
  id: string;
  label: string;
  start_year: number;
  end_year: number;
  is_current: boolean;
  is_completed: boolean;
};

type TabId = "geral" | "donut" | "badboys";

type StandingsPayload = { standings: StandingsRow[]; games: StandingsGame[] };

// ─── Camada de dados no SERVIDOR (Worker) ──────────────────────────────────────
// Antes cada tela batia no Supabase direto do navegador (Brasil -> Oregon,
// ~700ms por chamada, em cascata). Agora o Worker faz esse salto servidor-a-
// servidor e em paralelo; o browser só fala com o edge (perto do usuário).

// Cliente só-servidor. Prefere a service role (pula RLS, mais rápido) e cai na
// publishable se a service role não estiver no env do Worker. Usado apenas dentro
// dos handlers de createServerFn, então o bundler o remove do pacote do cliente.
function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase server env ausente (SUPABASE_URL / KEY).");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  }) as any;
}

// standings (via RPC) + jogos (só quando 1 temporada, pra Seq/L5), em paralelo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStandings(sb: any, ids: string[]): Promise<StandingsPayload> {
  if (!ids || ids.length === 0) return { standings: [], games: [] };
  const standingsPromise = sb.rpc("get_standings", { season_ids: ids });
  const gamesPromise =
    ids.length === 1
      ? sb
          .from("games")
          .select("id, home_team_id, away_team_id, home_score, away_score, week_number, game_number_in_week")
          .in("season_id", ids)
          .eq("is_playoff", false)
          .eq("status", "final")
      : Promise.resolve({ data: [], error: null });
  const [s, g] = await Promise.all([standingsPromise, gamesPromise]);
  return {
    standings: (s.data as StandingsRow[]) ?? [],
    games: (g.data as StandingsGame[]) ?? [],
  };
}

// Carga inicial: seasons + teams + standings da temporada corrente, tudo numa ida.
const fetchClassInitial = createServerFn({ method: "GET" }).handler(async () => {
  const sb = serverClient();
  const [seasonsRes, teamsRes] = await Promise.all([
    sb
      .from("seasons")
      .select("id, label, start_year, end_year, is_current, is_completed")
      .order("start_year", { ascending: false }),
    sb
      .from("teams")
      .select("id, name, slug, conference, is_active, logo_url, primary_color, gm:gms(full_name)"),
  ]);

  const seasons = (seasonsRes.data as Season[]) ?? [];
  const teams = (teamsRes.data as unknown as StandingsTeam[]) ?? [];
  const def = seasons.find((s) => s.is_current) ?? seasons[0];
  const defaultSeasonId = def?.id ?? null;

  const { standings, games } = defaultSeasonId
    ? await loadStandings(sb, [defaultSeasonId])
    : { standings: [], games: [] };

  return { seasons, teams, defaultSeasonId, standings, games };
});

// Troca de temporada no cliente: 1 chamada ao edge, queries paralelas no servidor.
const fetchClassStandings = createServerFn({ method: "GET" })
  .inputValidator((ids: string[]) => ids)
  .handler(async ({ data }): Promise<StandingsPayload> => {
    return loadStandings(serverClient(), data);
  });

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/classificacao")({
  head: () => ({
    meta: [
      { title: "Classificação — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Classificação da Liga Bola Presa." },
    ],
  }),
  // Cache leve: classificação muda pouco (jogos fecham ~1x/semana).
  staleTime: 30_000,
  loader: async () => fetchClassInitial(),
  component: ClassificacaoPage,
});

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

  function selectAll() {
    onChange(new Set(seasons.map((s) => s.id)));
  }

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
              <button
                type="button"
                onClick={() => {
                  selectAll();
                  setOpen(false);
                }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => {
                  selectCurrent();
                  setOpen(false);
                }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Atual
              </button>
              <button
                type="button"
                onClick={() => {
                  selectLast();
                  setOpen(false);
                }}
                className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Última
              </button>
            </div>

            <ul className="py-1">
              {seasons.map((s) => {
                const checked = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 flex-none items-center justify-center rounded border",
                          checked
                            ? "border-[color:var(--court)] bg-[color:var(--court)]"
                            : "border-border bg-background",
                        )}
                      >
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

// ─── Main page ────────────────────────────────────────────────────────────────

function ClassificacaoPage() {
  const initial = Route.useLoaderData();

  const seasons = initial.seasons as Season[];
  const teams = (initial.teams as unknown as StandingsTeam[]) ?? [];

  const [selectedSeasons, setSelectedSeasons] = useState<Set<string>>(
    () => new Set(initial.defaultSeasonId ? [initial.defaultSeasonId] : []),
  );
  const [standingsData, setStandingsData] = useState<StandingsRow[]>(initial.standings ?? []);
  const [games, setGames] = useState<StandingsGame[]>(initial.games ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("geral");

  // A carga inicial já veio do loader (SSR). O 1º disparo do efeito é ignorado;
  // daí em diante, trocar de temporada busca via server function (1 ida ao edge).
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }

    if (selectedSeasons.size === 0) {
      setGames([]);
      setStandingsData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const ids = Array.from(selectedSeasons);
    fetchClassStandings({ data: ids })
      .then((res: StandingsPayload) => {
        setStandingsData(res.standings ?? []);
        setGames(res.games ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [selectedSeasons]);

  const singleSeason = selectedSeasons.size === 1;

  const standingsMap = useMemo(() => {
    const m = new Map<string, StandingsRow>();
    for (const r of standingsData) m.set(r.team_id, r);
    return m;
  }, [standingsData]);

  const allStandings = useMemo(
    () => buildStandings(teams, games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap],
  );

  const donutStandings = useMemo(
    () => buildStandings(teams.filter((t) => t.conference === "Donut"), games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap],
  );

  const badboysStandings = useMemo(
    () => buildStandings(teams.filter((t) => t.conference === "Bad Boys"), games, singleSeason, standingsMap),
    [teams, games, singleSeason, standingsMap],
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: "geral", label: "Geral" },
    { id: "donut", label: "Donut" },
    { id: "badboys", label: "Bad Boys" },
  ];

  const currentStandings =
    activeTab === "geral" ? allStandings : activeTab === "donut" ? donutStandings : badboysStandings;

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
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">Classificação</h1>
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
              activeTab === tab.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showPlayoffCutoff && !loading && (
        <p className="mb-2 text-xs text-muted-foreground">Linha separa zona de playoffs (top 8).</p>
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
