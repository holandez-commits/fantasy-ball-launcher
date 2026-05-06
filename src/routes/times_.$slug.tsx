import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../integrations/supabase/client";
import { UserRound, ChevronLeft, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TeamDetail = {
  id: string;
  name: string;
  slug: string;
  conference: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  is_active: boolean;
  gm: { full_name: string; avatar_url: string | null; nickname: string | null } | null;
};

type TeamLite = { id: string; name: string; slug: string; is_active: boolean };

type RosterEntry = {
  id: string;
  position: string | null;
  status: string;
  player: { full_name: string } | null;
  contract_years: { season_label: string; salary: number }[];
};

type GameResult = {
  id: string;
  week_number: number | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_team: { name: string; slug: string } | null;
  away_team: { name: string; slug: string } | null;
};

type TeamStatRow = {
  game_id: string;
  team_id: string;
  week_number: number | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
};

type LeagueStatRow = {
  team_id: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
};

type Season = { id: string; label: string; is_completed: boolean; is_current: boolean };

type Penalty = { amount: number };

const CATS = [
  { key: "pts",       label: "Pontos",       emoji: "🏀", lowerIsBetter: false },
  { key: "reb",       label: "Rebotes",      emoji: "💪", lowerIsBetter: false },
  { key: "ast",       label: "Assistências", emoji: "🤝", lowerIsBetter: false },
  { key: "stl",       label: "Roubos",       emoji: "🫳", lowerIsBetter: false },
  { key: "blk",       label: "Tocos",        emoji: "✋", lowerIsBetter: false },
  { key: "three_pm",  label: "Bolas de 3",   emoji: "3️⃣", lowerIsBetter: false },
  { key: "turnovers", label: "Turnovers",    emoji: "🔄", lowerIsBetter: true  },
] as const;

type CatKey = typeof CATS[number]["key"];

const CAP = 69_500_000;
const CONTRACT_YEARS = ["26/27", "27/28", "28/29", "29/30", "30/31"];

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/times_/$slug")({
  component: TimePage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function fmtSalary(v: number) {
  if (!v || v === 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${(v / 1_000).toFixed(0)}K`;
}

function fmtSalaryFull(v: number) {
  if (!v || v === 0) return "—";
  return `$${v.toLocaleString("en-US")}`;
}

function ordinal(n: number) { return `${n}º`; }

function calcRankings(allStats: LeagueStatRow[], teamId: string, catKey: CatKey, lowerIsBetter: boolean) {
  const sorted = [...allStats].sort((a, b) =>
    lowerIsBetter ? a[catKey] - b[catKey] : b[catKey] - a[catKey]
  );
  const pos = sorted.findIndex((r) => r.team_id === teamId);
  return { general: pos + 1, total: sorted.length };
}

// ─── Team selector dropdown ───────────────────────────────────────────────────

function TeamSelector({ teams, currentSlug }: { teams: TeamLite[]; currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const current = teams.find((t) => t.slug === currentSlug);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        <span className="max-w-[240px] truncate">{current?.name ?? "Selecionar time"}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
            <ul className="py-1">
              {teams.map((t) => {
                const active = t.slug === currentSlug;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: "/times/$slug", params: { slug: t.slug } });
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <span className={cn(
                        "flex h-4 w-4 flex-none items-center justify-center rounded border",
                        active ? "border-[color:var(--court)] bg-[color:var(--court)]" : "border-border bg-background"
                      )}>
                        {active && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className={cn("flex-1 text-left", !t.is_active && "text-muted-foreground")}>
                        {t.name}
                        {!t.is_active && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-60">extinto</span>}
                      </span>
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

// ─── Team logo ────────────────────────────────────────────────────────────────

function TeamLogo({ team, size = "lg" }: { team: TeamDetail; size?: "sm" | "lg" }) {
  const sz = size === "lg" ? "h-20 w-20 text-2xl" : "h-10 w-10 text-sm";
  const bg = team.primary_color ?? "#374151";
  return (
    <div
      className={cn("flex flex-none items-center justify-center overflow-hidden rounded-full font-bold text-white", sz)}
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

function SectionTitle({ title }: { title: string }) {
  return <h2 className="mb-4 font-display text-xl tracking-tight">{title}</h2>;
}

// ─── Roster table ─────────────────────────────────────────────────────────────

function RosterTable({ entries, penaltyAmount, seasonLabel }: { entries: RosterEntry[]; penaltyAmount: number; seasonLabel: string }) {
  const active  = entries.filter((e) => e.status !== "injured_reserve");
  const injured = entries.filter((e) => e.status === "injured_reserve");
  const all     = [...active, ...injured];

  if (all.length === 0) {
    return <p className="text-sm text-muted-foreground">Elenco não disponível.</p>;
  }

  // Totais por ano
  const totals: Record<string, number> = {};
  for (const year of CONTRACT_YEARS) totals[year] = 0;
  for (const entry of all) {
    for (const cy of entry.contract_years ?? []) {
      if (totals[cy.season_label] !== undefined) {
        totals[cy.season_label] += cy.salary;
      }
    }
  }

  // Cap disponível = CAP - total26/27 - multas
  const currentYearTotal = totals["26/27"] ?? 0;
  const capUsed = currentYearTotal + penaltyAmount;
  const capAvailable = CAP - capUsed;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left">Jogador</th>
            <th className="px-4 py-3 text-left">Pos</th>
            {CONTRACT_YEARS.map((y) => (
              <th key={y} className="px-3 py-3 text-right hidden sm:table-cell">{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((entry, i) => {
            const isInjured = entry.status === "injured_reserve";
            const salaryMap = Object.fromEntries(
              (entry.contract_years ?? []).map((c) => [c.season_label, c.salary])
            );
            return (
              <tr
                key={entry.id}
                className={cn(
                  "border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40",
                  i % 2 === 1 ? "bg-muted/10" : "",
                  isInjured ? "opacity-50" : ""
                )}
              >
                <td className="px-4 py-2.5">
                  <span className={cn("font-medium", isInjured && "line-through")}>
                    {entry.player?.full_name ?? "—"}
                  </span>
                  {isInjured && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-600">IR</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{entry.position ?? "—"}</td>
                {CONTRACT_YEARS.map((y) => (
                  <td key={y} className="px-3 py-2.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                    {salaryMap[y] ? fmtSalary(salaryMap[y]) : "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>

        {/* Rodapé com totais */}
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/20 font-semibold">
            <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground" colSpan={2}>Total elenco</td>
            {CONTRACT_YEARS.map((y) => (
              <td key={y} className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">
                {totals[y] > 0 ? fmtSalary(totals[y]) : "—"}
              </td>
            ))}
          </tr>
          {penaltyAmount > 0 && (
            <tr className="border-t border-border/60 bg-muted/10 text-amber-600 dark:text-amber-400">
              <td className="px-4 py-2.5 text-xs uppercase tracking-wide" colSpan={2}>Multas</td>
              <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{fmtSalary(penaltyAmount)}</td>
              {CONTRACT_YEARS.slice(1).map((y) => (
                <td key={y} className="px-3 py-2.5 hidden sm:table-cell" />
              ))}
            </tr>
          )}
          <tr className={cn(
            "border-t border-border/60 font-bold",
            capAvailable >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          )}>
            <td className="px-4 py-2.5 text-xs uppercase tracking-wide" colSpan={2}>Cap disponível</td>
            {CONTRACT_YEARS.map((y, i) => {
              const yearSalary = totals[y] ?? 0;
              const yearCap = CAP - yearSalary - (i === 0 ? penaltyAmount : 0);
              return (
                <td key={y} className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">
                  {yearSalary > 0 || i === 0 ? fmtSalaryFull(yearCap) : "—"}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Last 5 games ─────────────────────────────────────────────────────────────

function Last5Table({ games, teamId }: { games: GameResult[]; teamId: string }) {
  if (games.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum jogo encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left">Sem.</th>
            <th className="px-4 py-3 text-left">Adversário</th>
            <th className="px-4 py-3 text-center">Placar</th>
            <th className="px-4 py-3 text-center">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => {
            const isHome  = g.home_team_id === teamId;
            const myScore = isHome ? g.home_score : g.away_score;
            const opScore = isHome ? g.away_score : g.home_score;
            const opp     = isHome ? g.away_team : g.home_team;
            const result  = myScore > opScore ? "W" : myScore < opScore ? "L" : "D";
            const resultColor =
              result === "W" ? "text-emerald-600 dark:text-emerald-400" :
              result === "L" ? "text-red-600 dark:text-red-400" :
              "text-amber-600 dark:text-amber-400";

            return (
              <tr key={g.id} className={cn(
                "border-b border-border/60 last:border-0 hover:bg-muted/40",
                i % 2 === 1 ? "bg-muted/10" : ""
              )}>
                <td className="px-4 py-2.5 text-muted-foreground">{g.week_number ?? "—"}</td>
                <td className="px-4 py-2.5 font-medium">
                  {opp ? (
                    <Link to="/times/$slug" params={{ slug: opp.slug }} className="hover:underline hover:text-[color:var(--court)]">
                      {opp.name}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-2.5 text-center tabular-nums">{myScore} – {opScore}</td>
                <td className={cn("px-4 py-2.5 text-center font-bold", resultColor)}>{result}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Stat chart ───────────────────────────────────────────────────────────────

function StatChart({ data, catKey }: { data: TeamStatRow[]; catKey: CatKey }) {
  const values = data.map((d) => Number(d[catKey]));
  if (values.length === 0) return <p className="text-sm text-muted-foreground">Sem dados para exibir.</p>;

  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || 1;
  const W = 560, H = 220;
  const PAD_L = 52, PAD_R = 20, PAD_T = 36, PAD_B = 40;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xOf = (i: number) => PAD_L + (i / Math.max(values.length - 1, 1)) * innerW;
  const yOf = (v: number) => PAD_T + (1 - (v - min) / range) * innerH;

  const points = values.map((v, i) => ({ x: xOf(i), y: yOf(v), v }));
  const pathD  = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD  = `${pathD} L${points[points.length - 1].x},${PAD_T + innerH} L${points[0].x},${PAD_T + innerH} Z`;

  // Y-axis ticks (3 values: min, mid, max)
  const ticks = [max, (max + min) / 2, min];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--court)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--court)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y-axis ticks */}
      {ticks.map((tick, i) => {
        const y = yOf(tick);
        return (
          <g key={i}>
            <line x1={PAD_L - 4} y1={y} x2={W - PAD_R} y2={y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="4 4" />
            <text x={PAD_L - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="currentColor" opacity="0.5">
              {Math.round(tick)}
            </text>
          </g>
        );
      })}

      {/* Area + line */}
      <path d={areaD} fill="url(#chartGrad)" />
      <path d={pathD} fill="none" stroke="var(--court)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points + labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={5} fill="var(--court)" />
          <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor">
            {Math.round(p.v)}
          </text>
          {/* X-axis label */}
          <text x={p.x} y={PAD_T + innerH + 18} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.55">
            S{data[i].week_number ?? i + 1}
          </text>
        </g>
      ))}

      {/* Axes */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="currentColor" strokeOpacity="0.2" />
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="currentColor" strokeOpacity="0.2" />
    </svg>
  );
}

// ─── Averages table ───────────────────────────────────────────────────────────

function AvgTable({ teamStats, allStats, teamId, conferenceTeamIds }: {
  teamStats: TeamStatRow[];
  allStats: LeagueStatRow[];
  teamId: string;
  conferenceTeamIds: string[];
}) {
  if (teamStats.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>;

  const avg = (key: CatKey) => {
    const sum = teamStats.reduce((acc, r) => acc + Number(r[key]), 0);
    return sum / teamStats.length;
  };

  const confStats = allStats.filter((r) => conferenceTeamIds.includes(r.team_id));

  const rankColor = (rank: number, total: number) => {
    const pct = rank / total;
    if (pct <= 0.25) return "text-purple-600 dark:text-purple-400";
    if (pct <= 0.5)  return "text-emerald-600 dark:text-emerald-400";
    if (pct <= 0.75) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 text-left">Categoria</th>
            <th className="px-4 py-3 text-right">Média</th>
            <th className="px-4 py-3 text-right hidden sm:table-cell">Liga</th>
            <th className="px-4 py-3 text-right hidden sm:table-cell">Conf.</th>
          </tr>
        </thead>
        <tbody>
          {CATS.map((cat, i) => {
            const mean = avg(cat.key);
            const { general: rankLiga, total: totalLiga } = calcRankings(allStats, teamId, cat.key, cat.lowerIsBetter);
            const { general: rankConf, total: totalConf } = calcRankings(confStats, teamId, cat.key, cat.lowerIsBetter);

            return (
              <tr key={cat.key} className={cn(
                "border-b border-border/60 last:border-0 hover:bg-muted/40",
                i % 2 === 1 ? "bg-muted/10" : ""
              )}>
                <td className="px-4 py-2.5 font-medium">
                  <span className="mr-2">{cat.emoji}</span>{cat.label}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{mean.toFixed(1)}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums hidden sm:table-cell font-medium", rankColor(rankLiga, totalLiga))}>
                  {ordinal(rankLiga)} / {totalLiga}
                </td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums hidden sm:table-cell font-medium", rankColor(rankConf, totalConf))}>
                  {ordinal(rankConf)} / {totalConf}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function TimePage() {
  const { slug } = Route.useParams();

  const [allTeams, setAllTeams]             = useState<TeamLite[]>([]);
  const [team, setTeam]                     = useState<TeamDetail | null>(null);
  const [roster, setRoster]                 = useState<RosterEntry[]>([]);
  const [penalty, setPenalty]               = useState<number>(0);
  const [last5, setLast5]                   = useState<GameResult[]>([]);
  const [last5Stats, setLast5Stats]         = useState<TeamStatRow[]>([]);
  const [allSeasonStats, setAllSeasonStats] = useState<TeamStatRow[]>([]);
  const [allLeagueStats, setAllLeagueStats] = useState<LeagueStatRow[]>([]);
  const [allTeamsFull, setAllTeamsFull]     = useState<{ id: string; conference: string | null }[]>([]);
  const [season, setSeason]                 = useState<Season | null>(null);
  const [selectedCat, setSelectedCat]       = useState<CatKey>("pts");
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  // Carrega lista de todos os times uma vez (para o seletor)
  useEffect(() => {
    supabase
      .from("teams")
      .select("id, name, slug, is_active")
      .order("name")
      .then(({ data }) => setAllTeams((data as TeamLite[]) ?? []));
  }, []);

  // Carrega dados do time quando slug muda
  useEffect(() => {
    setLoading(true);
    setError(null);

    (async () => {
      // 1. Time
      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, slug, conference, primary_color, secondary_color, logo_url, is_active, gm:gms(full_name, avatar_url, nickname)")
        .eq("slug", slug)
        .single();

      if (teamErr || !teamData) { setError("Time não encontrado."); setLoading(false); return; }
      const t = teamData as unknown as TeamDetail;
      setTeam(t);

      // 2. Temporada padrão
      const { data: seasons } = await supabase
        .from("seasons")
        .select("id, label, is_completed, is_current")
        .order("start_year", { ascending: false });

      const defaultSeason =
        (seasons ?? []).find((s) => s.is_current) ??
        (seasons ?? []).find((s) => s.is_completed) ??
        (seasons ?? [])[0];

      if (!defaultSeason) { setError("Sem temporada disponível."); setLoading(false); return; }
      setSeason(defaultSeason as Season);
      const seasonId = defaultSeason.id;

      // 3. Todos os times para ranking de conferência
      const { data: teamsData } = await supabase.from("teams").select("id, conference");
      setAllTeamsFull((teamsData ?? []) as { id: string; conference: string | null }[]);

      // 4. Elenco
      const { data: rosterData } = await supabase
        .from("roster_entries")
        .select("id, position, status, player:players(full_name)")
        .eq("team_id", t.id)
        .eq("season", 2025)
        .order("status");

      const rosterEntries = (rosterData as unknown as Omit<RosterEntry, "contract_years">[]) ?? [];

      // Busca anos de contrato separadamente
      const entryIds = rosterEntries.map((e) => e.id);
      let contractYearsData: { roster_entry_id: string; season_label: string; salary: number }[] = [];
      if (entryIds.length > 0) {
        const { data: cyData } = await supabase
          .from("roster_contract_years")
          .select("roster_entry_id, season_label, salary")
          .in("roster_entry_id", entryIds);
        contractYearsData = (cyData ?? []) as typeof contractYearsData;
      }

      // Monta roster com contract_years agrupados
      const rosterWithContracts: RosterEntry[] = rosterEntries.map((e) => ({
        ...e,
        contract_years: contractYearsData.filter((cy) => cy.roster_entry_id === e.id),
      }));
      setRoster(rosterWithContracts);

      // 5. Multas
      const { data: penaltyData } = await supabase
        .from("team_penalties")
        .select("amount")
        .eq("team_id", t.id)
        .eq("season_id", seasonId);
      const totalPenalty = ((penaltyData as Penalty[]) ?? []).reduce((sum, p) => sum + p.amount, 0);
      setPenalty(totalPenalty);

      // 6. Últimos 5 jogos
      const { data: gamesData } = await supabase
        .from("games")
        .select("id, week_number, home_team_id, away_team_id, home_score, away_score, home_team:teams!games_home_team_id_fkey(name, slug), away_team:teams!games_away_team_id_fkey(name, slug)")
        .eq("season_id", seasonId)
        .eq("is_playoff", false)
        .or(`home_team_id.eq.${t.id},away_team_id.eq.${t.id}`)
        .order("week_number", { ascending: false })
        .limit(5);
      setLast5((gamesData as unknown as GameResult[]) ?? []);

      // 7. Stats via RPC (temporada inteira)
      const { data: statsData } = await supabase.rpc("team_game_stats_totals", { season_ids: [seasonId] });
      const allStats = (statsData ?? []) as TeamStatRow[];

      // Stats deste time, ordenadas por semana
      const myStats = allStats
        .filter((r) => r.team_id === t.id)
        .sort((a, b) => (a.week_number ?? 0) - (b.week_number ?? 0));

      setAllSeasonStats(myStats);
      setLast5Stats(myStats.slice(-5));

      // Médias por time para ranking (temporada inteira)
      const teamAvgMap = new Map<string, { sum: Record<CatKey, number>; count: number }>();
      for (const row of allStats) {
        if (!teamAvgMap.has(row.team_id)) {
          teamAvgMap.set(row.team_id, {
            sum: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, three_pm: 0, turnovers: 0 },
            count: 0,
          });
        }
        const entry = teamAvgMap.get(row.team_id)!;
        for (const cat of CATS) entry.sum[cat.key] += Number(row[cat.key]);
        entry.count++;
      }

      const leagueAvgs: LeagueStatRow[] = Array.from(teamAvgMap.entries()).map(([tid, { sum, count }]) => ({
        team_id: tid,
        pts:       sum.pts       / count,
        reb:       sum.reb       / count,
        ast:       sum.ast       / count,
        stl:       sum.stl       / count,
        blk:       sum.blk       / count,
        three_pm:  sum.three_pm  / count,
        turnovers: sum.turnovers / count,
      }));

      setAllLeagueStats(leagueAvgs);
      setLoading(false);
    })();
  }, [slug]);

  const conferenceTeamIds = useMemo(() => {
    if (!team) return [];
    return allTeamsFull.filter((t) => t.conference === team.conference).map((t) => t.id);
  }, [team, allTeamsFull]);

  const selectedCatDef = CATS.find((c) => c.key === selectedCat)!;

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16 animate-pulse space-y-8">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-muted" />
            <div className="h-4 w-32 rounded bg-muted" />
          </div>
        </div>
        <div className="h-48 rounded-lg bg-muted" />
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 md:px-8">
        <p className="text-sm text-destructive">{error ?? "Time não encontrado."}</p>
        <Link to="/classificacao" className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">

      {/* Seletor de time + voltar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/classificacao" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Classificação
        </Link>
        <span className="text-muted-foreground/40">|</span>
        <TeamSelector teams={allTeams} currentSlug={slug} />
      </div>

      {/* Header do time */}
      <div className="mb-10 flex flex-wrap items-center gap-6">
        <TeamLogo team={team} size="lg" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
            {team.conference}
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight md:text-5xl">{team.name}</h1>
          {!team.is_active && (
            <span className="mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
              extinto
            </span>
          )}
        </div>

        {team.gm && (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full bg-muted">
              {team.gm.avatar_url ? (
                <img src={team.gm.avatar_url} alt={team.gm.full_name} className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">GM</p>
              <p className="font-medium">{team.gm.full_name}</p>
              {team.gm.nickname && <p className="text-xs text-muted-foreground">"{team.gm.nickname}"</p>}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-12">

        {/* 1. Elenco */}
        <section>
          <SectionTitle title={`Elenco ${season?.label ?? ""}`} />
          <RosterTable entries={roster} penaltyAmount={penalty} seasonLabel={season?.label ?? ""} />
        </section>

        {/* 2. Últimos 5 confrontos */}
        <section>
          <SectionTitle title="Últimos 5 confrontos" />
          <Last5Table games={last5} teamId={team.id} />
        </section>

        {/* 3. Gráfico por categoria */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle title="Desempenho por categoria" />
            <div className="flex flex-wrap gap-1">
              {CATS.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setSelectedCat(cat.key)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    selectedCat === cat.key
                      ? "bg-[color:var(--court)] text-white"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-4 text-sm text-muted-foreground">
              Últimas 5 semanas — {selectedCatDef.emoji} {selectedCatDef.label}
            </p>
            <StatChart data={last5Stats} catKey={selectedCat} />
          </div>
        </section>

        {/* 4. Médias e ranking */}
        <section>
          <SectionTitle title="Médias na temporada" />
          <AvgTable
            teamStats={allSeasonStats}
            allStats={allLeagueStats}
            teamId={team.id}
            conferenceTeamIds={conferenceTeamIds}
          />
        </section>

      </div>
    </div>
  );
}
