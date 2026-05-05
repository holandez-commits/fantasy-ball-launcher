import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import {
  ChevronDown, Check, Trophy, TrendingUp, Award,

} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Season = {
  id: string;
  label: string;
  start_year: number;
  is_current: boolean;
};

type TeamStatRow = {
  game_id: string;
  team_id: string;
  team_name: string;
  season_id: string;
  season_label: string;
  week_number: number | null;
  opp_name: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
};

type SeasonStandingRow = {
  team_id: string;
  team_name: string;
  season_id: string;
  season_label: string;
  w: number;
  d: number;
  l: number;
  gp: number;
};

type TeamMeta = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  logo_url: string | null;
  primary_color: string | null;
};

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/recordes")({
  head: () => ({
    meta: [
      { title: "Recordes — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Recordes históricos da Liga Bola Presa." },
    ],
  }),
  component: RecordesPage,
});

// ─── Category definitions ─────────────────────────────────────────────────────

const CATS = [
  { key: "pts",       label: "Pontos",        lowerIsBetter: false, icon: "🏀" },
  { key: "reb",       label: "Rebotes",       lowerIsBetter: false, icon: "💪" },
  { key: "ast",       label: "Assistências",  lowerIsBetter: false, icon: "🤝" },
  { key: "stl",       label: "Roubos",        lowerIsBetter: false, icon: "🫳" },
  { key: "blk",       label: "Tocos",         lowerIsBetter: false, icon: "✋" },
  { key: "three_pm",  label: "Bolas de 3",    lowerIsBetter: false, icon: "3️⃣" },
  { key: "turnovers", label: "Turnovers",     lowerIsBetter: true,  icon: "🔄" },
] as const;

type CatKey = typeof CATS[number]["key"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weekLabel(week: number | null) {
  return week != null ? `Sem. ${week}` : "—";
}

function pctStr(w: number, gp: number) {
  if (gp === 0) return ".000";
  return (w / gp).toFixed(3).replace(/^0/, "");
}

function pctColor(w: number, gp: number): string {
  const pct = gp > 0 ? w / gp : 0;
  if (pct >= 0.65) return "text-purple-600 dark:text-purple-400";
  if (pct >= 0.5)  return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 0.35) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-[color:var(--court)]">{icon}</span>
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
    </div>
  );
}

function TeamLogo({ team }: { team: TeamMeta }) {
  const bg = team.primary_color ?? "var(--muted)";
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shrink-0"
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

function RecordCard({
  catKey,
  label,
  lowerIsBetter,
  Icon,
  best,
  worst,
}: {
  catKey: CatKey;
  label: string;
  lowerIsBetter: boolean;
  Icon: string;
  best: TeamStatRow | null;
  worst: TeamStatRow | null;
}) {
  const topEntry   = lowerIsBetter ? worst : best;
  const bottomEntry = lowerIsBetter ? best  : worst;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Cabeçalho da categoria */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base leading-none">{Icon}</span>
        <p className="text-sm font-semibold text-foreground">{label}</p>
      </div>

      <div className="space-y-3">
        {/* Maior / Melhor */}
        {topEntry && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {lowerIsBetter ? "Menos" : "Mais"}
              </p>
              <p className="truncate font-medium leading-tight">{topEntry.team_name}</p>
              <p className="text-xs text-muted-foreground">
                vs {topEntry.opp_name} · {weekLabel(topEntry.week_number)} · {topEntry.season_label}
              </p>
            </div>
            <span className={cn(
              "shrink-0 text-2xl font-bold tabular-nums",
              lowerIsBetter
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-purple-600 dark:text-purple-400"
            )}>
              {topEntry[catKey]}
            </span>
          </div>
        )}

        <div className="border-t border-border/50" />

        {/* Menor / Pior */}
        {bottomEntry && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {lowerIsBetter ? "Mais" : "Menos"}
              </p>
              <p className="truncate font-medium leading-tight">{bottomEntry.team_name}</p>
              <p className="text-xs text-muted-foreground">
                vs {bottomEntry.opp_name} · {weekLabel(bottomEntry.week_number)} · {bottomEntry.season_label}
              </p>
            </div>
            <span className={cn(
              "shrink-0 text-2xl font-bold tabular-nums",
              lowerIsBetter
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
            )}>
              {bottomEntry[catKey]}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SeasonRecordsTable({
  best,
  worst,
}: {
  best: SeasonStandingRow | null;
  worst: SeasonStandingRow | null;
}) {
  const rows = [
    { label: "Melhor campanha", entry: best,  colorClass: "text-purple-600 dark:text-purple-400" },
    { label: "Pior campanha",   entry: worst, colorClass: "text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left w-40"></th>
            <th className="px-4 py-3 text-left">Time</th>
            <th className="px-4 py-3 text-left hidden sm:table-cell">Temporada</th>
            <th className="px-4 py-3 text-right">V</th>
            <th className="px-4 py-3 text-right">E</th>
            <th className="px-4 py-3 text-right">D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, entry, colorClass }) =>
            entry ? (
              <tr key={label} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{label}</td>
                <td className={cn("px-4 py-3 font-medium", colorClass)}>{entry.team_name}</td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{entry.season_label}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{entry.w}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.d}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{entry.l}</td>
              </tr>
            ) : null
          )}
        </tbody>
      </table>
    </div>
  );
}

function StreakTable({ standings }: { standings: SeasonStandingRow[] }) {
  // Calcula sequências a partir dos standings agregados por time+temporada
  // Melhor temporada W e pior temporada W servem como proxy de sequência máxima
  // A sequência real precisaria dos jogos ordenados — usamos os standings para mostrar
  // a melhor e pior performance contínua já registradas
  const byTeam = new Map<string, SeasonStandingRow[]>();
  for (const row of standings) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id)!.push(row);
  }

  // Maior sequência de vitórias: time com mais vitórias numa única temporada
  const allRows = [...standings].sort((a, b) => b.w - a.w);
  const bestW = allRows[0] ?? null;

  // Maior sequência de derrotas: time com mais derrotas numa única temporada
  const allRowsByL = [...standings].sort((a, b) => b.l - a.l);
  const bestL = allRowsByL[0] ?? null;

  const rows = [
    { label: "Mais vitórias em uma temporada",  entry: bestW, value: bestW?.w,  colorClass: "text-purple-600 dark:text-purple-400", suffix: "V" },
    { label: "Mais derrotas em uma temporada",  entry: bestL, value: bestL?.l,  colorClass: "text-red-600 dark:text-red-400",        suffix: "D" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left w-64"></th>
            <th className="px-4 py-3 text-left">Time</th>
            <th className="px-4 py-3 text-left hidden sm:table-cell">Temporada</th>
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, entry, value, colorClass, suffix }) =>
            entry ? (
              <tr key={label} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{label}</td>
                <td className={cn("px-4 py-3 font-medium", colorClass)}>{entry.team_name}</td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{entry.season_label}</td>
                <td className={cn("px-4 py-3 text-right tabular-nums font-bold text-lg", colorClass)}>
                  {value}{suffix}
                </td>
              </tr>
            ) : null
          )}
        </tbody>
      </table>
    </div>
  );
}

function AllTimeWinsTable({
  standings,
  teamMetaMap,
}: {
  standings: SeasonStandingRow[];
  teamMetaMap: Map<string, TeamMeta>;
}) {
  // Agrega todas as temporadas por time
  const byTeam = new Map<string, { w: number; d: number; l: number; gp: number }>();
  for (const row of standings) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, { w: 0, d: 0, l: 0, gp: 0 });
    const rec = byTeam.get(row.team_id)!;
    rec.w  += row.w;
    rec.d  += row.d;
    rec.l  += row.l;
    rec.gp += row.gp;
  }

  const rows = Array.from(byTeam.entries())
    .map(([tid, rec]) => ({ tid, ...rec }))
    .sort((a, b) => b.w - a.w || b.d - a.d);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 w-8">#</th>
            <th className="w-10 py-3 pl-2 pr-0" />
            <th className="px-4 py-3 text-left">Time</th>
            <th className="px-4 py-3 text-right">V</th>
            <th className="px-4 py-3 text-right">E</th>
            <th className="px-4 py-3 text-right">D</th>
            <th className="px-4 py-3 text-right">PCT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const meta = teamMetaMap.get(row.tid);
            const inactive = meta ? !meta.is_active : false;
            return (
              <tr
                key={row.tid}
                className={cn(
                  "border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40",
                  i % 2 === 1 ? "bg-muted/10" : "",
                  inactive ? "opacity-60" : ""
                )}
              >
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="py-3 pl-2 pr-0">
                  {meta && <TeamLogo team={meta} />}
                </td>
                <td className="px-4 py-3 font-medium">
                  {meta?.name ?? row.tid}
                  {inactive && (
                    <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                      extinto
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{row.w}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.d}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.l}</td>
                <td className={cn("px-4 py-3 text-right tabular-nums font-medium", pctColor(row.w, row.gp))}>
                  {pctStr(row.w, row.gp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
    : "Todas as temporadas";

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
              {[
                { id: null, label: "Todas as temporadas" },
                ...seasons.map((s) => ({ id: s.id, label: `Temporada ${s.label}` })),
              ].map((opt) => {
                const active = opt.id === selected;
                return (
                  <li key={opt.id ?? "all"}>
                    <button
                      type="button"
                      onClick={() => { onChange(opt.id); setOpen(false); }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <span className={cn(
                        "flex h-4 w-4 flex-none items-center justify-center rounded border",
                        active
                          ? "border-[color:var(--court)] bg-[color:var(--court)]"
                          : "border-border bg-background"
                      )}>
                        {active && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span>{opt.label}</span>
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-10 animate-pulse">
      {[1, 2, 3].map((s) => (
        <div key={s}>
          <div className="mb-4 h-5 w-40 rounded bg-muted" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((c) => (
              <div key={c} className="h-36 rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function RecordesPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStatRow[]>([]);
  const [seasonStandings, setSeasonStandings] = useState<SeasonStandingRow[]>([]);
  const [teamMetaMap, setTeamMetaMap] = useState<Map<string, TeamMeta>>(new Map());
  const [allSeasonIds, setAllSeasonIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carrega metadados uma vez
  useEffect(() => {
    (async () => {
      const [seasonsRes, teamsRes] = await Promise.all([
        supabase.from("seasons").select("id, label, start_year, is_current").order("start_year", { ascending: false }),
        supabase.from("teams").select("id, name, slug, is_active, logo_url, primary_color"),
      ]);

      if (seasonsRes.error || teamsRes.error) {
        setError(seasonsRes.error?.message ?? teamsRes.error?.message ?? "Erro");
        setLoading(false);
        return;
      }

      const tMap = new Map<string, TeamMeta>();
      for (const t of (teamsRes.data ?? []) as TeamMeta[]) tMap.set(t.id, t);

      const ids = (seasonsRes.data ?? []).map((s) => s.id);

      setSeasons((seasonsRes.data ?? []) as Season[]);
      setTeamMetaMap(tMap);
      setAllSeasonIds(ids);
    })();
  }, []);

  // Carrega dados quando filtro ou metadados mudam
  useEffect(() => {
    if (allSeasonIds.length === 0) return;

    setLoading(true);
    const ids = selectedSeason ? [selectedSeason] : allSeasonIds;

    Promise.all([
      supabase.rpc("team_game_stats_totals", { season_ids: ids }),
      supabase.rpc("team_season_standings",  { season_ids: ids }),
    ]).then(([statsRes, standingsRes]) => {
      if (statsRes.error)     { setError(statsRes.error.message);     setLoading(false); return; }
      if (standingsRes.error) { setError(standingsRes.error.message); setLoading(false); return; }
      setTeamStats((statsRes.data ?? []) as TeamStatRow[]);
      setSeasonStandings((standingsRes.data ?? []) as SeasonStandingRow[]);
      setLoading(false);
    });
  }, [selectedSeason, allSeasonIds]);

  // ── Recordes por categoria ────────────────────────────────────────────────

  const catRecords = useMemo(() => {
    return CATS.map((cat) => {
      if (teamStats.length === 0) return { ...cat, best: null, worst: null };
      const sorted = [...teamStats].sort((a, b) => b[cat.key] - a[cat.key]);
      return { ...cat, best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null };
    });
  }, [teamStats]);

  // ── Recordes de temporada ────────────────────────────────────────────────

  const seasonRecords = useMemo(() => {
    if (seasonStandings.length === 0) return { best: null, worst: null };
    const sorted = [...seasonStandings].sort((a, b) => b.w - a.w || b.d - a.d);
    return { best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null };
  }, [seasonStandings]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
          Liga Bola Presa
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">
          Recordes
        </h1>
      </div>

      {/* Filtro */}
      <div className="mb-10">
        <SeasonFilter seasons={seasons} selected={selectedSeason} onChange={setSelectedSeason} />
      </div>

      {error && <p className="mb-6 text-sm text-destructive">Erro: {error}</p>}

      {loading ? <Skeleton /> : (
        <div className="space-y-12">

          {/* 1. Recordes por categoria */}
          <section>
            <SectionTitle icon={<Trophy className="h-5 w-5" />} title="Recordes por categoria" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {catRecords.map((cat) => (
                <RecordCard
                  key={cat.key}
                  catKey={cat.key}
                  label={cat.label}
                  lowerIsBetter={cat.lowerIsBetter}
                  Icon={cat.icon}
                  best={cat.best}
                  worst={cat.worst}
                />
              ))}
            </div>
          </section>

          {/* 2. Recordes de temporada */}
          <section>
            <SectionTitle icon={<Award className="h-5 w-5" />} title="Recordes de temporada" />
            <SeasonRecordsTable best={seasonRecords.best} worst={seasonRecords.worst} />
          </section>

          {/* 3. Mais vitórias/derrotas numa temporada */}
          <section>
            <SectionTitle icon={<TrendingUp className="h-5 w-5" />} title="Marcas em uma temporada" />
            <StreakTable standings={seasonStandings} />
          </section>

          {/* 4. All-time wins */}
          <section>
            <SectionTitle icon={<Trophy className="h-5 w-5" />} title="Mais vitórias no histórico" />
            <AllTimeWinsTable standings={seasonStandings} teamMetaMap={teamMetaMap} />
          </section>

        </div>
      )}
    </div>
  );
}