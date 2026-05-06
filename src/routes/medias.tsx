import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = {
  id: string;
  label: string;
  start_year: number;
  is_current: boolean;
  is_completed: boolean;
};

type TeamStatRow = {
  game_id: string;
  team_id: string;
  team_name: string;
  week_number: number | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
};

type TeamMeta = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
};

type AvgRow = {
  team_id: string;
  team_name: string;
  slug: string;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
  gp: number;
};

type CatKey = "pts" | "reb" | "ast" | "stl" | "blk" | "three_pm" | "turnovers";
type SortDir = "asc" | "desc";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/medias")({
  head: () => ({
    meta: [
      { title: "Médias — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Médias por categoria dos times da Liga Bola Presa." },
    ],
  }),
  component: MediasPage,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const CATS: { key: CatKey; label: string; emoji: string; lowerIsBetter: boolean }[] = [
  { key: "pts",       label: "PTS",  emoji: "🏀", lowerIsBetter: false },
  { key: "reb",       label: "REB",  emoji: "💪", lowerIsBetter: false },
  { key: "ast",       label: "AST",  emoji: "🤝", lowerIsBetter: false },
  { key: "stl",       label: "STL",  emoji: "🫳", lowerIsBetter: false },
  { key: "blk",       label: "BLK",  emoji: "✋", lowerIsBetter: false },
  { key: "three_pm",  label: "3PM",  emoji: "3️⃣", lowerIsBetter: false },
  { key: "turnovers", label: "TO",   emoji: "🔄", lowerIsBetter: true  },
];

const GAME_FILTER_OPTIONS = [
  { value: "all", label: "Todos os jogos" },
  { value: "10",  label: "Últimos 10" },
  { value: "5",   label: "Últimos 5" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function pctColor(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 0.25) return "text-purple-600 dark:text-purple-400";
  if (pct <= 0.5)  return "text-emerald-600 dark:text-emerald-400";
  if (pct <= 0.75) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

// ─── Season filter ────────────────────────────────────────────────────────────

function SeasonFilter({
  seasons,
  selected,
  onChange,
}: {
  seasons: Season[];
  selected: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected
    ? `Temporada ${seasons.find((s) => s.id === selected)?.label ?? ""}`
    : "Temporada atual";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        <span>{label}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card shadow-md">
            <ul className="py-1">
              {seasons.map((s) => {
                const active = s.id === selected || (selected === null && s.is_current);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { onChange(s.id); setOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent",
                        active && "font-medium text-[color:var(--court)]"
                      )}
                    >
                      Temporada {s.label}
                      {s.is_current && <span className="ml-auto text-[10px] uppercase tracking-wide opacity-60">atual</span>}
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

// ─── Game filter ──────────────────────────────────────────────────────────────

function GameFilter({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {GAME_FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            selected === opt.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: SortDir }) {
  if (col !== sortCol) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3" />
    : <ChevronDown className="h-3 w-3" />;
}

// ─── Team logo (mini) ─────────────────────────────────────────────────────────

function TeamLogoMini({ row }: { row: AvgRow }) {
  const bg = row.primary_color ?? "#374151";
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shrink-0"
      style={{ background: bg }}
    >
      {row.logo_url ? (
        <img src={row.logo_url} alt={row.team_name} className="h-full w-full object-cover" />
      ) : (
        <span>{teamInitials(row.team_name)}</span>
      )}
    </div>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────

function AvgTable({
  rows,
  sortCol,
  sortDir,
  onSort,
}: {
  rows: AvgRow[];
  sortCol: string;
  sortDir: SortDir;
  onSort: (col: string) => void;
}) {
  // Rank por categoria (para colorir)
  const ranks = useMemo(() => {
    const result: Record<CatKey, Map<string, number>> = {} as any;
    for (const cat of CATS) {
      const sorted = [...rows].sort((a, b) =>
        cat.lowerIsBetter ? a[cat.key] - b[cat.key] : b[cat.key] - a[cat.key]
      );
      const map = new Map<string, number>();
      sorted.forEach((r, i) => map.set(r.team_id, i + 1));
      result[cat.key] = map;
    }
    return result;
  }, [rows]);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum dado encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left w-8">#</th>
            <th className="w-10 py-3 pl-2 pr-0" />
            <th className="px-4 py-3 text-left">Time</th>
            <th className="px-3 py-3 text-right text-muted-foreground/60 font-normal">GP</th>
            {CATS.map((cat) => (
              <th key={cat.key} className="px-3 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onSort(cat.key)}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  {cat.emoji} {cat.label}
                  <SortIcon col={cat.key} sortCol={sortCol} sortDir={sortDir} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.team_id}
              className={cn(
                "border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40",
                i % 2 === 1 ? "bg-muted/10" : "",
                !row.is_active ? "opacity-60" : ""
              )}
            >
              <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
              <td className="py-2.5 pl-2 pr-0">
                <TeamLogoMini row={row} />
              </td>
              <td className="px-4 py-2.5">
                <Link
                  to="/times/$slug"
                  params={{ slug: row.slug }}
                  className="font-medium hover:underline hover:text-[color:var(--court)]"
                >
                  {row.team_name}
                </Link>
                {!row.is_active && (
                  <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                    extinto
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.gp}</td>
              {CATS.map((cat) => {
                const rank = ranks[cat.key].get(row.team_id) ?? 0;
                return (
                  <td
                    key={cat.key}
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums font-medium",
                      sortCol === cat.key ? pctColor(rank, rows.length) : ""
                    )}
                  >
                    {row[cat.key].toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card animate-pulse">
      <div className="space-y-px">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="h-4 w-4 rounded bg-muted" />
            <div className="h-7 w-7 rounded-full bg-muted" />
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="ml-auto flex gap-6">
              {Array.from({ length: 7 }).map((_, j) => (
                <div key={j} className="h-4 w-10 rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function MediasPage() {
  const [seasons, setSeasons]           = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [gameFilter, setGameFilter]     = useState("all");
  const [rawStats, setRawStats]         = useState<TeamStatRow[]>([]);
  const [teamMeta, setTeamMeta]         = useState<Map<string, TeamMeta>>(new Map());
  const [allSeasonIds, setAllSeasonIds] = useState<string[]>([]);
  const [sortCol, setSortCol]           = useState<string>("pts");
  const [sortDir, setSortDir]           = useState<SortDir>("desc");
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // Carrega metadados uma vez
  useEffect(() => {
    (async () => {
      const [seasonsRes, teamsRes] = await Promise.all([
        supabase.from("seasons").select("id, label, start_year, is_current, is_completed").order("start_year", { ascending: false }),
        supabase.from("teams").select("id, name, slug, is_active, logo_url, primary_color"),
      ]);

      if (seasonsRes.error || teamsRes.error) {
        setError(seasonsRes.error?.message ?? teamsRes.error?.message ?? "Erro");
        setLoading(false);
        return;
      }

      const fetchedSeasons = (seasonsRes.data ?? []) as Season[];
      const tMap = new Map<string, TeamMeta>();
      for (const t of (teamsRes.data ?? []) as TeamMeta[]) tMap.set(t.id, t);

      setSeasons(fetchedSeasons);
      setTeamMeta(tMap);
      setAllSeasonIds(fetchedSeasons.map((s) => s.id));

      // Default: temporada atual
      const current = fetchedSeasons.find((s) => s.is_current) ?? fetchedSeasons[0];
      if (current) setSelectedSeason(current.id);
    })();
  }, []);

  // Carrega stats quando temporada muda
  useEffect(() => {
    if (allSeasonIds.length === 0 || !selectedSeason) return;

    setLoading(true);
    supabase
      .rpc("team_game_stats_totals", { season_ids: [selectedSeason] })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRawStats((data ?? []) as TeamStatRow[]);
        setLoading(false);
      });
  }, [selectedSeason, allSeasonIds]);

  // Agrupa stats por time, aplica filtro de últimos N jogos, calcula médias
  const avgRows: AvgRow[] = useMemo(() => {
    if (rawStats.length === 0) return [];

    // Agrupa por time
    const byTeam = new Map<string, TeamStatRow[]>();
    for (const row of rawStats) {
      if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
      byTeam.get(row.team_id)!.push(row);
    }

    return Array.from(byTeam.entries()).map(([tid, rows]) => {
      const meta = teamMeta.get(tid);

      // Ordena por semana desc para pegar últimos N
      const sorted = [...rows].sort((a, b) => (b.week_number ?? 0) - (a.week_number ?? 0));
      const filtered = gameFilter === "all" ? sorted : sorted.slice(0, Number(gameFilter));
      const gp = filtered.length;

      const avg = (key: CatKey) => filtered.reduce((sum, r) => sum + Number(r[key]), 0) / gp;

      return {
        team_id:      tid,
        team_name:    meta?.name    ?? rows[0].team_name,
        slug:         meta?.slug    ?? "",
        is_active:    meta?.is_active ?? true,
        logo_url:     meta?.logo_url ?? null,
        primary_color: meta?.primary_color ?? null,
        pts:       avg("pts"),
        reb:       avg("reb"),
        ast:       avg("ast"),
        stl:       avg("stl"),
        blk:       avg("blk"),
        three_pm:  avg("three_pm"),
        turnovers: avg("turnovers"),
        gp,
      };
    });
  }, [rawStats, gameFilter, teamMeta]);

  // Ordena
  const sortedRows = useMemo(() => {
    const catDef = CATS.find((c) => c.key === sortCol);
    return [...avgRows].sort((a, b) => {
      const aVal = (a as any)[sortCol];
      const bVal = (b as any)[sortCol];
      // Para turnovers, inverter o padrão quando não há sort explícito
      const mul = sortDir === "asc" ? 1 : -1;
      return (aVal - bVal) * mul;
    });
  }, [avgRows, sortCol, sortDir]);

  function handleSort(col: string) {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      // Turnovers: default asc (menor = melhor); demais: desc
      const catDef = CATS.find((c) => c.key === col);
      setSortDir(catDef?.lowerIsBetter ? "asc" : "desc");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
          Liga Bola Presa
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">Médias</h1>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SeasonFilter seasons={seasons} selected={selectedSeason} onChange={setSelectedSeason} />
        <GameFilter selected={gameFilter} onChange={setGameFilter} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">Erro: {error}</p>}

      {loading ? <Skeleton /> : (
        <AvgTable
          rows={sortedRows}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      {/* Legenda */}
      {!loading && avgRows.some((r) => !r.is_active) && (
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
