import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import {
  db,
  callRpc,
  fmtMoney,
  fmtMoneyShort,
  fetchCurrentSeason,
  fetchMarketOpen,
  groupTradeByDirection,
  type CurrentSeason,
} from "@/lib/market";
import { MarketStateBanner } from "@/components/MarketStateBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { espnPlayerUrl } from "@/lib/links";
import { contractFromYears, fmtYearsLeft } from "@/lib/contracts";

export const Route = createFileRoute("/trocar")({
  head: () => ({
    meta: [
      { title: "Propor troca — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { com?: string } => ({
    com: typeof search.com === "string" && search.com ? search.com : undefined,
  }),
  component: TrocarPage,
});

const PENALTY_MIN = 50_000;
const CAP_LIMIT = 70_000_000; // teto (mesmo valor do servidor)
const SLOT_LIMIT = 15; // vagas ativas (IR não conta)

type TeamLite = { id: string; name: string };
type PlayerAsset = {
  kind: "player";
  id: string;
  name: string;
  position: string | null;
  salary: number;
  years: number;
  espnId: string | null;
};
type PickAsset = { kind: "pick"; id: string; label: string; origin: string | null; lock?: string | null };
// Multa consolidada por ano: id = "<time>|<ano>" (único entre os times da troca); parts = linhas reais de team_penalties que a compõem.
type PenaltyAsset = {
  kind: "penalty";
  id: string;
  label: string;
  saldo: number;
  parts: { id: string; amount: number }[];
};
type Asset = PlayerAsset | PickAsset | PenaltyAsset;
type TeamAssets = { players: PlayerAsset[]; picks: PickAsset[]; penalties: PenaltyAsset[] };

type Sel = { from: string; to: string; amount?: string };

// Resposta da função simular_troca (banco): mesmas regras do propor_troca, sem gravar nada.
type SimTeam = {
  team_id: string;
  name: string;
  cap_before: number;
  cap_after: number;
  slots_before: number;
  slots_after: number;
};
type Sim = { valid: boolean; errors: string[]; teams: SimTeam[] };

const akey = (a: Asset) => `${a.kind}:${a.id}`;

function splitKey(k: string): { kind: string; id: string } {
  const i = k.indexOf(":");
  return { kind: k.slice(0, i), id: k.slice(i + 1) };
}

function findAsset(assets: TeamAssets | undefined, kind: string, id: string): Asset | undefined {
  if (!assets) return undefined;
  if (kind === "player") return assets.players.find((p) => p.id === id);
  if (kind === "pick") return assets.picks.find((p) => p.id === id);
  return assets.penalties.find((p) => p.id === id);
}

function assetName(a: Asset): string {
  return a.kind === "player" ? a.name : a.label;
}

/** Texto do ativo no resumo: "Trae Young (PG · $14,450K · 2 anos)", "Pick 1ª · 27/28 · de X", "Multa 26/27 · $500,000". */
function describeAsset(a: Asset, sel: Sel): string {
  if (a.kind === "player") {
    const bits = [
      a.position,
      a.salary ? fmtMoneyShort(a.salary) : null,
      a.years > 0 ? (a.years === 1 ? "1 ano" : `${a.years} anos`) : null,
    ].filter(Boolean);
    return bits.length ? `${a.name} (${bits.join(" · ")})` : a.name;
  }
  if (a.kind === "pick") return a.origin ? `${a.label} · de ${a.origin}` : a.label;
  const amt = Math.round(Number(sel.amount));
  return `${a.label} · ${fmtMoney(amt > 0 ? amt : a.saldo)}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">{children}</div>;
}

function defaultDeadline(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDeadline(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Monta os itens do propor_troca a partir da seleção. Erros locais = o que dá pra checar sem ir ao servidor. */
function buildItens(selected: Record<string, Sel>, assetsByTeam: Record<string, TeamAssets>) {
  const itens: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const [k, sel] of Object.entries(selected)) {
    const { kind, id } = splitKey(k);
    const asset = findAsset(assetsByTeam[sel.from], kind, id);
    const label = asset ? assetName(asset) : "Item";
    if (!sel.to) {
      errors.push(`${label}: escolha o time de destino.`);
      continue;
    }
    if (sel.to === sel.from) {
      errors.push(`${label}: origem igual ao destino.`);
      continue;
    }
    if (kind === "player") {
      itens.push({ asset_type: "player", player_id: id, from_team_id: sel.from, to_team_id: sel.to });
    } else if (kind === "pick") {
      itens.push({ asset_type: "pick", pick_id: id, from_team_id: sel.from, to_team_id: sel.to });
    } else {
      const pen = asset as PenaltyAsset | undefined;
      if (!pen) {
        errors.push("Multa não encontrada. Recarregue a página.");
        continue;
      }
      const amt = Math.round(Number(sel.amount));
      if (!amt) {
        errors.push(`${pen.label}: informe o valor.`);
        continue;
      }
      if (amt < PENALTY_MIN) {
        errors.push(`${pen.label}: mínimo por ano é ${fmtMoney(PENALTY_MIN)} (informado ${fmtMoney(amt)}).`);
        continue;
      }
      if (amt > pen.saldo) {
        errors.push(`${pen.label}: valor acima do saldo (${fmtMoney(pen.saldo)}).`);
        continue;
      }
      // reparte o valor do ano entre as linhas de origem (maiores primeiro)
      let left = amt;
      for (const part of pen.parts) {
        if (left <= 0) break;
        const take = Math.min(part.amount, left);
        itens.push({
          asset_type: "penalty",
          source_penalty_id: part.id,
          from_team_id: sel.from,
          to_team_id: sel.to,
          amount: take,
        });
        left -= take;
      }
    }
  }
  return { itens, errors };
}

async function loadTeamAssets(teamId: string, season: CurrentSeason): Promise<TeamAssets> {
  // jogadores ativos
  const reRes = await db
    .from("roster_entries")
    .select("id, player_id, position, player:players(full_name, espn_id)")
    .eq("team_id", teamId)
    .eq("season", season.start_year)
    .eq("status", "active");
  const entries = (reRes.data ?? []) as {
    id: string;
    player_id: string;
    position: string | null;
    player: { full_name: string; espn_id: string | null } | null;
  }[];
  const entryIds = entries.map((e) => e.id);
  let cy: { roster_entry_id: string; season_label: string; salary: number }[] = [];
  if (entryIds.length > 0) {
    const cyRes = await db
      .from("roster_contract_years")
      .select("roster_entry_id, season_label, salary")
      .in("roster_entry_id", entryIds);
    cy = (cyRes.data ?? []) as typeof cy;
  }
  const players: PlayerAsset[] = entries
    .map((e) => ({
      kind: "player" as const,
      id: e.player_id,
      name: e.player?.full_name ?? "—",
      espnId: e.player?.espn_id ?? null,
      position: e.position,
      salary: cy.find((c) => c.roster_entry_id === e.id && c.season_label === season.label)?.salary ?? 0,
      years:
        contractFromYears(
          cy.filter((c) => c.roster_entry_id === e.id),
          season.label,
        )?.years ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // picks negociáveis
  const pkRes = await db
    .from("draft_picks")
    .select(
      "id, round, original_team_id, season:seasons!draft_picks_draft_season_id_fkey(label), original_team:teams!draft_picks_original_team_id_fkey(name)",
    )
    .eq("current_team_id", teamId)
    .eq("is_used", false)
    .eq("disputed", false);
  // 1ª própria bloqueada (regra: nunca 2 anos seguidos sem a própria 1ª)
  const lockById: Record<string, string> = {};
  try {
    const { data: lk } = await (db as any).rpc("get_picks_proprias_status");
    for (const r of (lk ?? []) as { pick_id: string; locked: boolean; reason: string | null }[]) {
      if (r.locked) lockById[r.pick_id] = r.reason ?? "regra da 1ª própria";
    }
  } catch {
    /* sem o bloqueio visual; o banco continua validando */
  }
  const picks: PickAsset[] = ((pkRes.data ?? []) as {
    id: string;
    round: number;
    original_team_id: string;
    season: { label: string } | null;
    original_team: { name: string } | null;
  }[])
    .map((p) => ({
      kind: "pick" as const,
      id: p.id,
      label: `Pick ${p.round}ª · ${p.season?.label ?? "—"}`,
      origin: p.original_team?.name ?? null,
      lock: lockById[p.id] ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // multas com saldo — consolidadas: uma linha por ano (soma de todas as linhas daquele ano)
  const penRes = await db
    .from("team_penalties")
    .select("id, amount, season:seasons(label, start_year)")
    .eq("team_id", teamId)
    .gt("amount", 0);
  const byYear = new Map<string, { start: number; parts: { id: string; amount: number }[] }>();
  for (const p of (penRes.data ?? []) as {
    id: string;
    amount: number;
    season: { label: string; start_year: number } | null;
  }[]) {
    const label = p.season?.label ?? "—";
    const cur = byYear.get(label) ?? { start: p.season?.start_year ?? 9999, parts: [] };
    cur.parts.push({ id: p.id, amount: p.amount });
    byYear.set(label, cur);
  }
  const penalties: PenaltyAsset[] = [...byYear.entries()]
    .sort((a, b) => a[1].start - b[1].start)
    .map(([label, v]) => ({
      kind: "penalty" as const,
      id: `${teamId}|${label}`,
      label: `Multa ${label}`,
      saldo: v.parts.reduce((acc, x) => acc + x.amount, 0),
      parts: [...v.parts].sort((a, b) => b.amount - a.amount),
    }));

  return { players, picks, penalties };
}

function TrocarPage() {
  const { ready, forbidden, teamId } = useRequireAuth({ role: "gm" });
  const { com } = Route.useSearch(); // vindo do trade block: já adiciona esse time na proposta
  const comApplied = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [allTeams, setAllTeams] = useState<TeamLite[]>([]);
  const [assetsByTeam, setAssetsByTeam] = useState<Record<string, TeamAssets>>({});
  const [capBase, setCapBase] = useState<Record<string, number>>({}); // cap usado hoje, por time

  const [otherIds, setOtherIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, Sel>>({});
  const [deadline, setDeadline] = useState<string>(defaultDeadline());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [done, setDone] = useState<{
    groups: { from: string; to: string; labels: string[] }[];
    teams: string[];
    deadline: string;
  } | null>(null);

  // Simulação (cap, vagas e validade) via banco
  const [sim, setSim] = useState<Sim | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const simSeq = useRef(0);

  const teamName = useCallback(
    (id: string) => allTeams.find((t) => t.id === id)?.name ?? "—",
    [allTeams],
  );

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const cur = await fetchCurrentSeason();
      if (!cur) {
        setLoadError("Nenhuma temporada corrente configurada.");
        setLoading(false);
        return;
      }
      setSeason(cur);
      setMarketOpen(await fetchMarketOpen(cur.id));

      const teamsRes = await db
        .from("teams")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      setAllTeams(((teamsRes.data ?? []) as (TeamLite & { is_active: boolean })[]).map((t) => ({ id: t.id, name: t.name })));

      // cap usado hoje por time (base da prévia); se falhar, a prévia mostra só o que o simulador devolver
      const capRes = await callRpc("team_cap_usage", { _season_id: cur.id });
      if (!capRes.error && Array.isArray(capRes.data)) {
        setCapBase(
          Object.fromEntries(
            (capRes.data as { team_id: string; used: number | string }[]).map((r) => [r.team_id, Number(r.used)]),
          ),
        );
      }

      setAssetsByTeam({ [teamId]: await loadTeamAssets(teamId, cur) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (ready && teamId) void load();
  }, [ready, teamId, load]);

  useEffect(() => {
    if (!com || comApplied.current || loading || !season || !teamId) return;
    if (!allTeams.some((t) => t.id === com)) return;
    comApplied.current = true;
    void addTeam(com);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [com, loading, season, teamId, allTeams]);

  const participating = useMemo(
    () => (teamId ? [teamId, ...otherIds] : otherIds),
    [teamId, otherIds],
  );

  async function addTeam(id: string) {
    if (!id || !season || id === teamId || otherIds.includes(id)) return;
    setOtherIds((cur) => [...cur, id]);
    if (!assetsByTeam[id]) {
      const a = await loadTeamAssets(id, season);
      setAssetsByTeam((cur) => ({ ...cur, [id]: a }));
    }
  }

  function removeTeam(id: string) {
    setOtherIds((cur) => cur.filter((t) => t !== id));
    // dropa itens que envolvem o time removido
    setSelected((cur) => {
      const next: Record<string, Sel> = {};
      for (const [k, v] of Object.entries(cur)) {
        if (v.from !== id && v.to !== id) next[k] = v;
      }
      return next;
    });
  }

  function destDefault(fromTeam: string): string {
    return participating.find((t) => t !== fromTeam) ?? "";
  }

  function toggleAsset(a: Asset, fromTeam: string) {
    setResult(null);
    const k = akey(a);
    setSelected((cur) => {
      const next = { ...cur };
      if (next[k]) {
        delete next[k];
      } else {
        next[k] = {
          from: fromTeam,
          to: destDefault(fromTeam),
          amount: a.kind === "penalty" ? String(a.saldo) : undefined,
        };
      }
      return next;
    });
  }

  function setDest(k: string, to: string) {
    setResult(null);
    setSelected((cur) => ({ ...cur, [k]: { ...cur[k], to } }));
  }
  function setAmount(k: string, amount: string) {
    setResult(null);
    setSelected((cur) => ({ ...cur, [k]: { ...cur[k], amount } }));
  }

  const count = Object.keys(selected).length;
  const built = useMemo(() => buildItens(selected, assetsByTeam), [selected, assetsByTeam]);

  // Prévia: roda a simulação no banco (debounce) sempre que os itens mudam
  const itensKey = JSON.stringify(built.itens);
  useEffect(() => {
    const my = ++simSeq.current;
    if (built.itens.length === 0) {
      setSim(null);
      setSimError(null);
      setSimLoading(false);
      return;
    }
    setSimLoading(true);
    const t = setTimeout(async () => {
      const { data, error } = await callRpc("simular_troca", { _itens: built.itens });
      if (my !== simSeq.current) return; // chegou uma seleção mais nova
      setSimLoading(false);
      if (error || !data) {
        setSim(null);
        setSimError(error?.message ?? "sem resposta");
      } else {
        setSim(data as Sim);
        setSimError(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itensKey]);

  // Resumo por direção: "X envia para Y: ..."
  const summary = useMemo(() => {
    const items: { label: string; fromName: string; toName: string }[] = [];
    for (const [k, sel] of Object.entries(selected)) {
      if (!sel.to) continue;
      const { kind, id } = splitKey(k);
      const a = findAsset(assetsByTeam[sel.from], kind, id);
      if (!a) continue;
      items.push({ label: describeAsset(a, sel), fromName: teamName(sel.from), toName: teamName(sel.to) });
    }
    return groupTradeByDirection(items);
  }, [selected, assetsByTeam, teamName]);

  const problems = [...built.errors, ...(sim?.errors ?? [])];
  const previewUnavailable = simError !== null; // função de simulação indisponível: o servidor confere ao propor
  const canPropose =
    count > 0 &&
    built.errors.length === 0 &&
    !submitting &&
    !simLoading &&
    (sim ? sim.valid : previewUnavailable);

  const impactOf = (tid: string) => {
    const st = sim?.teams.find((t) => t.team_id === tid);
    const slotsNow = assetsByTeam[tid]?.players.length;
    return {
      capBefore: st?.cap_before ?? capBase[tid],
      capAfter: st?.cap_after ?? capBase[tid],
      slotsBefore: st?.slots_before ?? slotsNow,
      slotsAfter: st?.slots_after ?? slotsNow,
    };
  };

  async function propor() {
    if (!teamId) return;
    if (built.errors.length > 0) {
      setResult({ ok: false, message: built.errors[0] });
      return;
    }
    if (built.itens.length === 0) {
      setResult({ ok: false, message: "Selecione ao menos um ativo pra trocar." });
      return;
    }
    const deadlineISO = deadline ? new Date(deadline).toISOString() : null;
    const snapshot = {
      groups: summary,
      teams: participating.map((t) => teamName(t)),
      deadline: fmtDeadline(deadline),
    };
    setSubmitting(true);
    setResult(null);
    const { error } = await callRpc("propor_troca", {
      _itens: built.itens,
      _week: null,
      _accept_deadline: deadlineISO,
    });
    setSubmitting(false);
    if (error) {
      setResult({ ok: false, message: error.message });
    } else {
      setSelected({});
      setDone(snapshot);
      // a confirmação ocupa o lugar do formulário: sobe pro topo pra ficar à vista
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function novaProposta() {
    setDone(null);
    setResult(null);
    setOtherIds([]);
    setSelected({});
    comApplied.current = true;
    void load();
  }

  if (forbidden) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">Esta área é restrita a GMs da liga.</p>
      </Shell>
    );
  }
  if (!ready) return null;
  if (!teamId) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Propor troca</h1>
        <Alert className="mt-6">
          <AlertDescription>Sua conta não tem time associado.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const addable = allTeams.filter((t) => t.id !== teamId && !otherIds.includes(t.id));
  const twoTeams = otherIds.length === 1;

  return (
    <Shell>
      <div className="mb-6">
        <Link to="/mercado" className="text-sm text-muted-foreground hover:text-foreground">
          ← Mercado
        </Link>
      </div>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Temporada {season?.label ?? ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Propor troca</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Escolha o time e marque o que cada lado envia. O painel mostra, na hora, como ficam o cap e as
        vagas de cada time e se a troca é válida antes de você propor.
      </p>

      <div className="mt-6">
        <MarketStateBanner isOpen={marketOpen} />
      </div>

      {loadError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {done ? (
        <section className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-lg text-white">
              ✓
            </span>
            <div>
              <h2 className="font-display text-xl">Proposta enviada</h2>
              <p className="text-sm text-muted-foreground">
                Aguardando o aceite de {done.teams.filter((t) => t !== teamName(teamId)).join(", ") || "os outros times"}
                {" "}até {done.deadline}.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {done.groups.map((g) => (
              <p key={`${g.from}>${g.to}`}>
                <span className="font-medium">{g.from}</span> envia para{" "}
                <span className="font-medium">{g.to}</span>: {g.labels.join(" · ")}
              </p>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/mercado">Ver no Mercado</Link>
            </Button>
            <Button variant="outline" onClick={novaProposta}>
              Propor outra troca
            </Button>
          </div>
        </section>
      ) : loading ? (
        <Skeleton className="mt-8 h-96 w-full" />
      ) : (
        <>
          {/* Times envolvidos */}
          <section className="mt-8">
            <Label className="text-sm">Times na troca</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[color:var(--court)]/15 px-3 py-1 text-sm font-medium">
                {teamName(teamId)} <span className="ml-1 text-xs text-muted-foreground">(você)</span>
              </span>
              {otherIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
                >
                  {teamName(id)}
                  <button
                    type="button"
                    onClick={() => removeTeam(id)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label="remover time"
                  >
                    ✕
                  </button>
                </span>
              ))}
              {addable.length > 0 && (
                <select
                  value=""
                  onChange={(e) => void addTeam(e.target.value)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
                >
                  <option value="">{otherIds.length === 0 ? "Escolher o time da troca" : "+ adicionar time"}</option>
                  {addable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {otherIds.length === 1 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Para uma troca entre 3 ou mais times, adicione outro time: aí cada item escolhe o destino.
              </p>
            )}
          </section>

          {otherIds.length === 0 ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Escolha com qual time você quer negociar para montar a troca.
            </p>
          ) : (
            <>
              {/* 2 times: lado a lado. 3 ou mais: uma coluna, com destino por item. */}
              <div className={cn("mt-6 grid gap-4", twoTeams ? "lg:grid-cols-2" : "grid-cols-1")}>
                {participating.map((tid) => {
                  const imp = impactOf(tid);
                  return (
                    <TeamPanel
                      key={tid}
                      teamId={tid}
                      teamLabel={teamName(tid)}
                      isMine={tid === teamId}
                      assets={assetsByTeam[tid]}
                      participating={participating}
                      teamName={teamName}
                      selected={selected}
                      onToggle={(a) => toggleAsset(a, tid)}
                      onDest={setDest}
                      onAmount={setAmount}
                      showDest={!twoTeams}
                      impact={
                        <TeamImpact
                          capBefore={imp.capBefore}
                          capAfter={imp.capAfter}
                          slotsBefore={imp.slotsBefore}
                          slotsAfter={imp.slotsAfter}
                          loading={simLoading}
                        />
                      }
                    />
                  );
                })}
              </div>

              {/* Resumo + validação */}
              <section className="mt-6 rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Resumo da proposta
                </div>
                <div className="space-y-3 px-4 py-4 text-sm">
                  {summary.length === 0 ? (
                    <p className="text-muted-foreground">Marque jogadores, picks ou multas para montar a troca.</p>
                  ) : (
                    summary.map((g) => (
                      <p key={`${g.from}>${g.to}`}>
                        <span className="font-medium">{g.from}</span> envia para{" "}
                        <span className="font-medium">{g.to}</span>:{" "}
                        <span className="text-muted-foreground">{g.labels.join(" · ")}</span>
                      </p>
                    ))
                  )}

                  {count > 0 && (
                    <div className="border-t border-border/60 pt-3">
                      {simLoading ? (
                        <p className="text-muted-foreground">Verificando a troca…</p>
                      ) : problems.length > 0 ? (
                        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">
                          <p className="font-semibold">
                            {problems.length === 1 ? "Esta troca não pode ser proposta:" : "Esta troca não pode ser proposta:"}
                          </p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5">
                            {problems.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      ) : sim?.valid ? (
                        <p className="font-medium text-emerald-700 dark:text-emerald-400">
                          ✓ Troca válida: cap, vagas e regras das picks estão ok.
                        </p>
                      ) : previewUnavailable ? (
                        <p className="text-amber-700 dark:text-amber-400">
                          Não foi possível pré-validar agora. O servidor confere tudo ao propor.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Barra de ação: fica sempre à vista, e o resultado da proposta aparece aqui */}
          {otherIds.length > 0 && (
            <div className="sticky bottom-0 z-30 -mx-4 mt-8 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
              {result && !result.ok && (
                <Alert variant="destructive" className="mb-3">
                  <AlertTitle>Não foi possível propor</AlertTitle>
                  <AlertDescription>{result.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="deadline" className="text-sm">
                    Prazo de aceite
                  </Label>
                  <Input
                    id="deadline"
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-56"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={cn(
                      "text-sm",
                      count === 0 || simLoading
                        ? "text-muted-foreground"
                        : problems.length > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {count === 0
                      ? "Nada selecionado"
                      : simLoading
                        ? "Verificando…"
                        : problems.length > 0
                          ? `${problems.length} ${problems.length === 1 ? "problema" : "problemas"}`
                          : sim?.valid
                            ? "Troca válida"
                            : ""}
                  </span>
                  <Button onClick={() => void propor()} disabled={!canPropose}>
                    {submitting ? "Enviando..." : `Propor troca (${count})`}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

/** Cap e vagas de um time: antes → depois, com a barra do teto e alerta quando estoura. */
function TeamImpact({
  capBefore,
  capAfter,
  slotsBefore,
  slotsAfter,
  loading,
}: {
  capBefore: number | undefined;
  capAfter: number | undefined;
  slotsBefore: number | undefined;
  slotsAfter: number | undefined;
  loading: boolean;
}) {
  const capOver = capAfter != null && capAfter > CAP_LIMIT;
  const slotsOver = slotsAfter != null && slotsAfter > SLOT_LIMIT;
  const capChanged = capBefore != null && capAfter != null && capBefore !== capAfter;
  const slotsChanged = slotsBefore != null && slotsAfter != null && slotsBefore !== slotsAfter;
  const pct = capAfter != null ? Math.max(0, Math.min(100, (capAfter / CAP_LIMIT) * 100)) : 0;
  const free = capAfter != null ? CAP_LIMIT - capAfter : null;
  const fmtCap = (v: number | undefined) => (v == null ? "—" : v === 0 ? "$0" : fmtMoneyShort(v));

  return (
    <div className={cn("grid gap-3 px-4 py-3 text-sm sm:grid-cols-2", loading && "opacity-60")}>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cap</span>
          <span className={cn("tabular-nums", capOver && "font-semibold text-red-600 dark:text-red-400")}>
            {capChanged && <span className="text-muted-foreground">{fmtCap(capBefore)} → </span>}
            {fmtCap(capAfter)}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", capOver ? "bg-red-500" : "bg-[color:var(--court)]")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={cn("mt-1 text-xs tabular-nums", capOver ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          {free == null
            ? "teto $70,000K"
            : capOver
              ? `estoura o teto em ${fmtMoneyShort(Math.abs(free))}`
              : `livre ${free === 0 ? "$0" : fmtMoneyShort(free)} de $70,000K`}
        </p>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vagas</span>
          <span className={cn("tabular-nums", slotsOver && "font-semibold text-red-600 dark:text-red-400")}>
            {slotsChanged && <span className="text-muted-foreground">{slotsBefore} → </span>}
            {slotsAfter ?? "—"} / {SLOT_LIMIT}
          </span>
        </div>
        <p className={cn("mt-1 text-xs", slotsOver ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          {slotsAfter == null
            ? "máx 15 jogadores ativos"
            : slotsOver
              ? `${slotsAfter - SLOT_LIMIT} acima do limite (IR não conta)`
              : `${SLOT_LIMIT - slotsAfter} ${SLOT_LIMIT - slotsAfter === 1 ? "vaga livre" : "vagas livres"} (IR não conta)`}
        </p>
      </div>
    </div>
  );
}

function TeamPanel({
  teamId,
  teamLabel,
  isMine,
  assets,
  participating,
  teamName,
  selected,
  onToggle,
  onDest,
  onAmount,
  showDest,
  impact,
}: {
  teamId: string;
  teamLabel: string;
  isMine: boolean;
  assets: TeamAssets | undefined;
  participating: string[];
  teamName: (id: string) => string;
  selected: Record<string, Sel>;
  onToggle: (a: Asset) => void;
  onDest: (k: string, to: string) => void;
  onAmount: (k: string, amount: string) => void;
  /** 3+ times: cada item escolhe o destino. Com 2 times o destino é o outro time. */
  showDest: boolean;
  impact: React.ReactNode;
}) {
  const dests = participating.filter((t) => t !== teamId);
  const otherName = dests.length === 1 ? teamName(dests[0]) : null;

  const row = (a: Asset, main: React.ReactNode) => {
    const k = akey(a);
    const sel = selected[k];
    const on = !!sel;
    return (
      <div key={k} className={cn("px-4 py-2.5 transition-colors", on && "bg-[color:var(--court)]/10")}>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={on} onChange={() => onToggle(a)} className="h-4 w-4" />
          <span className="flex-1">{main}</span>
        </label>
        {on && (showDest || a.kind === "penalty") && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-sm">
            {showDest && (
              <>
                <span className="text-xs text-muted-foreground">envia para</span>
                <select
                  value={sel.to}
                  onChange={(e) => onDest(k, e.target.value)}
                  className="rounded-md border border-border bg-card px-2 py-1 text-sm"
                >
                  <option value="">— escolher —</option>
                  {dests.map((d) => (
                    <option key={d} value={d}>
                      {teamName(d)}
                    </option>
                  ))}
                </select>
              </>
            )}
            {a.kind === "penalty" && (
              <>
                <span className="text-xs text-muted-foreground">valor (mín {fmtMoney(PENALTY_MIN)})</span>
                <Input
                  type="number"
                  min={PENALTY_MIN}
                  step={50000}
                  value={sel.amount ?? ""}
                  onChange={(e) => onAmount(k, e.target.value)}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">de {fmtMoney(a.saldo)}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const group = (title: string, children: React.ReactNode[]) =>
    children.length === 0 ? null : (
      <div>
        <div className="bg-muted/20 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <div className="divide-y divide-border/60">{children}</div>
      </div>
    );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {teamLabel} envia{isMine ? " (você)" : ""}
        {!showDest && otherName && <span className="ml-1 normal-case tracking-normal">→ {otherName}</span>}
      </div>
      <div className="border-b border-border/60">{impact}</div>
      {!assets ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : assets.players.length + assets.picks.length + assets.penalties.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nada negociável.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {group(
            `Jogadores (${assets.players.length})`,
            assets.players.map((p) =>
              row(
                p,
                <span>
                  {p.espnId ? (
                    <a
                      href={espnPlayerUrl(p.espnId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ver na ESPN"
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </a>
                  ) : (
                    <span className="font-medium">{p.name}</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">{p.position ?? "—"}</span>
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {p.salary ? fmtMoneyShort(p.salary) : "—"}
                    {p.years > 0 && ` · ${fmtYearsLeft(p.years)}`}
                  </span>
                </span>,
              ),
            ),
          )}
          {group(
            "Picks",
            assets.picks.map((p) =>
              p.lock ? (
                <div key={akey(p)} className="px-4 py-2.5">
                  <label className="flex cursor-not-allowed items-center gap-3 text-sm">
                    <input type="checkbox" disabled className="h-4 w-4" />
                    <span className="flex-1 text-red-600 dark:text-red-400">
                      {p.label}
                      <span className="ml-1 text-[10px] uppercase tracking-wide">
                        · indisponível para troca ({p.lock})
                      </span>
                    </span>
                  </label>
                </div>
              ) : (
                row(
                  p,
                  <span>
                    {p.label}
                    {p.origin && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        · de {p.origin}
                      </span>
                    )}
                  </span>,
                )
              ),
            ),
          )}
          {group(
            "Multas",
            assets.penalties.map((p) =>
              row(
                p,
                <span className="text-amber-700 dark:text-amber-400">
                  {p.label} · saldo {fmtMoney(p.saldo)}
                </span>,
              ),
            ),
          )}
        </div>
      )}
    </div>
  );
}
