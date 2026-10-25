import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import {
  db,
  callRpc,
  fmtMoney,
  previaMulta,
  fetchCurrentSeason,
  fetchMarketOpen,
  TX_TYPE_LABEL,
  TX_STATUS_LABEL,
  IR_TYPE_LABEL,
  IR_TYPE_RULE,
  irCapSalary,
  irTypeLabel,
  statusTone,
  groupTradeByDirection,
  type CurrentSeason,
  type ContractYear,
  type IrType,
} from "@/lib/market";
import { MarketStateBanner } from "@/components/MarketStateBanner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/mercado")({
  head: () => ({
    meta: [
      { title: "Mercado — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MercadoPage,
});

type RosterPlayer = {
  entryId: string;
  playerId: string;
  name: string;
  position: string | null;
  years: ContractYear[];
  currentSalary: number;
  multaAnos: number;
  multaAnoUniforme: number | null;
  multaTotal: number;
};

type IrPlayer = {
  entryId: string;
  playerId: string;
  name: string;
  position: string | null;
  irSince: number | null;
  irType: string | null;
  capSalary: number;
};

type MyTx = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  week_number: number | null;
  playerName: string | null;
};

type TradeItemView = { label: string; fromName: string; toName: string };
type TradeView = {
  id: string;
  status: string;
  isProposer: boolean;
  myApproval: boolean | null; // null = ainda não decidi
  awaiting: string[]; // times que ainda não aceitaram
  items: TradeItemView[];
  deadline: string | null;
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

function MercadoPage() {
  const { ready, forbidden, teamId, gmId } = useRequireAuth({ role: "gm" });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [irList, setIrList] = useState<IrPlayer[]>([]);
  const [myTx, setMyTx] = useState<MyTx[]>([]);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [pendingReleaseIds, setPendingReleaseIds] = useState<Set<string>>(new Set());
  const [pendingIrIds, setPendingIrIds] = useState<Set<string>>(new Set());

  const [relTarget, setRelTarget] = useState<RosterPlayer | null>(null);
  const [irTarget, setIrTarget] = useState<RosterPlayer | null>(null);
  const [irChoice, setIrChoice] = useState<IrType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyTrade, setBusyTrade] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadTrades = useCallback(async () => {
    if (!teamId) return;
    const trRes = await db
      .from("transactions")
      .select("id, status, proposed_by, accept_deadline, created_at")
      .eq("type", "trade")
      .in("status", ["proposed", "accepted"])
      .order("created_at", { ascending: false });
    const trs = (trRes.data ?? []) as {
      id: string;
      status: string;
      proposed_by: string | null;
      accept_deadline: string | null;
    }[];
    if (trs.length === 0) {
      setTrades([]);
      return;
    }
    const ids = trs.map((t) => t.id);
    const [itRes, apRes] = await Promise.all([
      db
        .from("transaction_items")
        .select("transaction_id, asset_type, player_id, pick_id, amount, from_team_id, to_team_id")
        .in("transaction_id", ids),
      db
        .from("transaction_approvals")
        .select("transaction_id, team_id, accepted")
        .in("transaction_id", ids),
    ]);
    const items = (itRes.data ?? []) as {
      transaction_id: string;
      asset_type: string;
      player_id: string | null;
      pick_id: string | null;
      amount: number | null;
      from_team_id: string | null;
      to_team_id: string | null;
    }[];
    const approvals = (apRes.data ?? []) as {
      transaction_id: string;
      team_id: string;
      accepted: boolean | null;
    }[];

    const teamIds = [
      ...new Set([
        ...(items.flatMap((i) => [i.from_team_id, i.to_team_id]).filter(Boolean) as string[]),
        ...approvals.map((a) => a.team_id),
      ]),
    ];
    const playerIds = [...new Set(items.map((i) => i.player_id).filter(Boolean) as string[])];
    const pickIds = [...new Set(items.map((i) => i.pick_id).filter(Boolean) as string[])];

    const [teamsRes, playersRes, picksRes] = await Promise.all([
      teamIds.length ? db.from("teams").select("id, name").in("id", teamIds) : { data: [] },
      playerIds.length ? db.from("players").select("id, full_name").in("id", playerIds) : { data: [] },
      pickIds.length
        ? db
            .from("draft_picks")
            .select("id, round, season:seasons!draft_picks_draft_season_id_fkey(label)")
            .in("id", pickIds)
        : { data: [] },
    ]);
    const teamName = Object.fromEntries(
      ((teamsRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
    );
    const playerName = Object.fromEntries(
      ((playersRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
    );
    const pickLabel = Object.fromEntries(
      ((picksRes.data ?? []) as { id: string; round: number; season: { label: string } | null }[]).map(
        (p) => [p.id, `Pick ${p.round}ª · ${p.season?.label ?? "—"}`],
      ),
    );

    const views: TradeView[] = trs.flatMap((t) => {
      const myItems = items.filter((i) => i.transaction_id === t.id);
      const myApprovals = approvals.filter((a) => a.transaction_id === t.id);
      // Só mostra trocas que envolvem o MEU time (admin vê tudo pelo RLS; aqui
      // é a tela do GM, então filtramos). A visão geral fica em /admin/mercado.
      const teamsEnvolvidos = new Set<string>([
        ...myApprovals.map((a) => a.team_id),
        ...(myItems.flatMap((i) => [i.from_team_id, i.to_team_id]).filter(Boolean) as string[]),
      ]);
      if (!teamsEnvolvidos.has(teamId)) return [];
      const mine = myApprovals.find((a) => a.team_id === teamId);
      return [{
        id: t.id,
        status: t.status,
        isProposer: !!gmId && t.proposed_by === gmId,
        myApproval: mine ? mine.accepted : null,
        awaiting: myApprovals
          .filter((a) => a.accepted !== true)
          .map((a) => teamName[a.team_id] ?? "—"),
        deadline: t.accept_deadline,
        items: myItems.map((i) => ({
          label:
            i.asset_type === "player"
              ? i.player_id
                ? playerName[i.player_id] ?? "—"
                : "—"
              : i.asset_type === "pick"
                ? i.pick_id
                  ? pickLabel[i.pick_id] ?? "Pick"
                  : "Pick"
                : `Multa ${fmtMoney(i.amount ?? 0)}`,
          fromName: i.from_team_id ? teamName[i.from_team_id] ?? "—" : "—",
          toName: i.to_team_id ? teamName[i.to_team_id] ?? "—" : "—",
        })),
      }];
    });
    setTrades(views);
  }, [teamId, gmId]);

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

      const reRes = await db
        .from("roster_entries")
        .select("id, player_id, position, status, ir_since_season, ir_type, player:players(full_name)")
        .eq("team_id", teamId)
        .eq("season", cur.start_year)
        .in("status", ["active", "injured_reserve"]);
      if (reRes.error) throw new Error(reRes.error.message);
      const entries = (reRes.data ?? []) as {
        id: string;
        player_id: string;
        position: string | null;
        status: string;
        ir_since_season: number | null;
        ir_type: string | null;
        player: { full_name: string } | null;
      }[];

      const activeEntries = entries.filter((e) => e.status === "active");
      const irEntries = entries.filter((e) => e.status === "injured_reserve");

      // contratos de todos (ativos e IR): o IR também mostra quanto do salário conta no cap
      const allIds = entries.map((e) => e.id);
      let cy: { roster_entry_id: string; season_label: string; salary: number }[] = [];
      if (allIds.length > 0) {
        const cyRes = await db
          .from("roster_contract_years")
          .select("roster_entry_id, season_label, salary")
          .in("roster_entry_id", allIds);
        if (cyRes.error) throw new Error(cyRes.error.message);
        cy = (cyRes.data ?? []) as typeof cy;
      }

      setRoster(
        activeEntries
          .map((e) => {
            const years = cy
              .filter((c) => c.roster_entry_id === e.id)
              .map((c) => ({ season_label: c.season_label, salary: c.salary }));
            const currentSalary = years.find((y) => y.season_label === cur.label)?.salary ?? 0;
            const prv = previaMulta(years);
            return {
              entryId: e.id,
              playerId: e.player_id,
              name: e.player?.full_name ?? "—",
              position: e.position,
              years,
              currentSalary,
              multaAnos: prv.anos,
              multaAnoUniforme: prv.anoUniforme,
              multaTotal: prv.total,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      setIrList(
        irEntries
          .map((e) => {
            const sal =
              cy.find((c) => c.roster_entry_id === e.id && c.season_label === cur.label)?.salary ?? 0;
            return {
              entryId: e.id,
              playerId: e.player_id,
              name: e.player?.full_name ?? "—",
              position: e.position,
              irSince: e.ir_since_season,
              irType: e.ir_type,
              capSalary: irCapSalary(sal, e.ir_type),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      const txRes = await db
        .from("transactions")
        .select("id, type, status, created_at, week_number")
        .order("created_at", { ascending: false })
        .limit(25);
      if (txRes.error) throw new Error(txRes.error.message);
      const txs = (txRes.data ?? []) as Omit<MyTx, "playerName">[];

      const txIds = txs.map((t) => t.id);
      let pItems: { transaction_id: string; player_id: string | null; asset_type: string }[] = [];
      if (txIds.length > 0) {
        const itRes = await db
          .from("transaction_items")
          .select("transaction_id, player_id, asset_type")
          .in("transaction_id", txIds)
          .eq("asset_type", "player");
        if (!itRes.error) pItems = (itRes.data ?? []) as typeof pItems;
      }
      const playerIds = [...new Set(pItems.map((i) => i.player_id).filter(Boolean) as string[])];
      let nameById: Record<string, string> = {};
      if (playerIds.length > 0) {
        const pRes = await db.from("players").select("id, full_name").in("id", playerIds);
        if (!pRes.error) {
          nameById = Object.fromEntries(
            (pRes.data as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
          );
        }
      }
      const firstPlayerOf = (txId: string) => {
        const it = pItems.find((i) => i.transaction_id === txId && i.player_id);
        return it?.player_id ? nameById[it.player_id] ?? null : null;
      };
      setMyTx(txs.map((t) => ({ ...t, playerName: firstPlayerOf(t.id) })));

      const pendRel = new Set<string>();
      const pendIr = new Set<string>();
      for (const t of txs) {
        if (t.status !== "proposed" && t.status !== "approved") continue;
        const it = pItems.find((i) => i.transaction_id === t.id && i.player_id);
        if (!it?.player_id) continue;
        if (t.type === "release") pendRel.add(it.player_id);
        if (t.type === "ir") pendIr.add(it.player_id);
      }
      setPendingReleaseIds(pendRel);
      setPendingIrIds(pendIr);

      await loadTrades();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar o mercado.");
    } finally {
      setLoading(false);
    }
  }, [teamId, loadTrades]);

  useEffect(() => {
    if (ready && teamId) void load();
  }, [ready, teamId, load]);

  async function confirmarDispensa() {
    if (!relTarget) return;
    setSubmitting(true);
    setResult(null);
    const { error } = await callRpc("propor_dispensa", { _player_id: relTarget.playerId });
    setSubmitting(false);
    setRelTarget(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: "Dispensa proposta. Agora aguarda a aprovação do admin." });
      void load();
    }
  }

  async function confirmarIr() {
    if (!irTarget || !irChoice) return;
    setSubmitting(true);
    setResult(null);
    const { error } = await callRpc("solicitar_ir", {
      _player_id: irTarget.playerId,
      _ir_type: irChoice,
    });
    setSubmitting(false);
    setIrTarget(null);
    setIrChoice(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: "IR solicitado. Agora aguarda a aprovação do admin." });
      void load();
    }
  }

  async function aceitarTroca(txId: string, aceitar: boolean) {
    setBusyTrade(txId);
    setResult(null);
    const { data, error } = await callRpc("aceitar_troca", { _tx_id: txId, _aceitar: aceitar });
    setBusyTrade(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Registrado." });
      void load();
    }
  }

  async function cancelarTroca(txId: string) {
    setBusyTrade(txId);
    setResult(null);
    const { data, error } = await callRpc("cancelar_troca", { _tx_id: txId });
    setBusyTrade(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Troca cancelada." });
      void load();
    }
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
        <h1 className="font-display text-3xl">Mercado</h1>
        <Alert className="mt-6">
          <AlertDescription>Sua conta não tem time associado.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Temporada {season?.label ?? ""}
          </p>
          <h1 className="mt-1 font-display text-3xl">Mercado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Dispense, coloque em IR ou proponha trocas. Toda movimentação passa pela aprovação do
            admin.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/leilao">Leilão</Link>
          </Button>
          <Button asChild>
            <Link to="/trocar">Propor troca</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <MarketStateBanner isOpen={marketOpen} />
      </div>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Feito" : "Não foi possível"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <>
          <Skeleton className="mt-8 h-8 w-40" />
          <Skeleton className="mt-4 h-64 w-full" />
        </>
      ) : (
        <>
          {/* Trocas que me envolvem */}
          {trades.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 font-display text-xl tracking-tight">Trocas</h2>
              <div className="space-y-3">
                {trades.map((t) => {
                  const awaitingMe = t.status === "proposed" && t.myApproval === null;
                  const canCancel =
                    t.isProposer && (t.status === "proposed" || t.status === "accepted");
                  return (
                    <div key={t.id} className="rounded-lg border border-border bg-card px-4 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-wide",
                            statusTone(t.status),
                          )}
                        >
                          {TX_STATUS_LABEL[t.status] ?? t.status}
                        </span>
                        {t.isProposer && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            · você propôs
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 text-sm">
                        {groupTradeByDirection(t.items).map((g, gi) => (
                          <div key={gi}>
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {g.from} envia para {g.to}
                            </div>
                            <ul className="mt-0.5 space-y-0.5 pl-3">
                              {g.labels.map((l, li) => (
                                <li key={li} className="font-medium">
                                  {l}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t.status === "accepted"
                            ? "Todos aceitaram — aguardando o admin."
                            : t.awaiting.length > 0
                              ? `Aguardando aceite: ${t.awaiting.join(", ")}`
                              : ""}
                        </span>
                        <div className="flex gap-2">
                          {awaitingMe && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => void aceitarTroca(t.id, true)}
                                disabled={busyTrade === t.id}
                              >
                                {busyTrade === t.id ? "..." : "Aceitar"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void aceitarTroca(t.id, false)}
                                disabled={busyTrade === t.id}
                              >
                                Recusar
                              </Button>
                            </>
                          )}
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void cancelarTroca(t.id)}
                              disabled={busyTrade === t.id}
                            >
                              Cancelar
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Meu elenco — dispensa / IR */}
          <section className="mt-10">
            <h2 className="mb-4 font-display text-xl tracking-tight">Meu elenco</h2>
            {roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum jogador ativo no elenco.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Jogador</th>
                      <th className="px-4 py-3 text-left">Pos</th>
                      <th className="px-3 py-3 text-right">Salário {season?.label}</th>
                      <th className="px-3 py-3 text-right">Multa/ano</th>
                      <th className="px-3 py-3 text-right">Anos</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((p, i) => {
                      const pendRel = pendingReleaseIds.has(p.playerId);
                      const pendIr = pendingIrIds.has(p.playerId);
                      const pending = pendRel || pendIr;
                      return (
                        <tr
                          key={p.entryId}
                          className={cn(
                            "border-b border-border/60 last:border-0 hover:bg-muted/40",
                            i % 2 === 1 ? "bg-muted/10" : "",
                          )}
                        >
                          <td className="px-4 py-2.5 font-medium">{p.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{p.position ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.currentSalary ? fmtMoney(p.currentSalary) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {p.multaAnos === 0 ? (
                              <span className="text-muted-foreground">sem multa</span>
                            ) : p.multaAnoUniforme != null ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                {fmtMoney(p.multaAnoUniforme)}
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">varia</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.multaAnos > 0 ? p.multaAnos : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {pending ? (
                              <span className="inline-flex items-center rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                {pendRel ? "dispensa pendente" : "IR pendente"}
                              </span>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setResult(null);
                                    setRelTarget(p);
                                  }}
                                >
                                  Dispensar
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setResult(null);
                                    setIrChoice(null);
                                    setIrTarget(p);
                                  }}
                                >
                                  Pôr em IR
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              A multa é estimada; o valor final é calculado quando o admin executa a dispensa (por
              ano restante do contrato).
            </p>
          </section>

          {/* Lesionados (IR) */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">Reserva de lesionados (IR)</h2>
            {irList.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum jogador em IR.</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left">Jogador</th>
                        <th className="px-4 py-3 text-left">Pos</th>
                        <th className="px-4 py-3 text-left">Tipo</th>
                        <th className="px-3 py-3 text-right">No cap {season?.label}</th>
                        <th className="px-4 py-3 text-left">Em IR desde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {irList.map((p, i) => (
                        <tr
                          key={p.entryId}
                          className={cn(
                            "border-b border-border/60 last:border-0",
                            i % 2 === 1 ? "bg-muted/10" : "",
                          )}
                        >
                          <td className="px-4 py-2.5 font-medium">{p.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{p.position ?? "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {irTypeLabel(p.irType) ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.capSalary ? fmtMoney(p.capSalary) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{p.irSince ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Jogador em IR não ocupa vaga. IR parcial: o salário continua contando no cap. IR
                  fora da temporada: conta só 20% do salário da temporada atual e o retorno é só na
                  próxima temporada. A reativação é feita pelo admin.
                </p>
              </>
            )}
          </section>

          {/* Minhas movimentações */}
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl tracking-tight">Minhas movimentações</h2>
            {myTx.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Tipo</th>
                      <th className="px-4 py-3 text-left">Jogador</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Quando</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myTx.map((t, i) => (
                      <tr
                        key={t.id}
                        className={cn(
                          "border-b border-border/60 last:border-0",
                          i % 2 === 1 ? "bg-muted/10" : "",
                        )}
                      >
                        <td className="px-4 py-2.5">{TX_TYPE_LABEL[t.type] ?? t.type}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{t.playerName ?? "—"}</td>
                        <td className={cn("px-4 py-2.5 font-medium", statusTone(t.status))}>
                          {TX_STATUS_LABEL[t.status] ?? t.status}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {new Date(t.created_at).toLocaleDateString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Confirmação de dispensa */}
      <AlertDialog open={!!relTarget} onOpenChange={(o) => !submitting && !o && setRelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dispensar {relTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  O jogador sai do seu elenco e a proposta vai pra fila do admin. Se aprovada e
                  executada, nasce a multa abaixo (estimativa).
                </p>
                {relTarget && relTarget.multaTotal > 0 ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Multa estimada por ano
                    </div>
                    <ul className="space-y-0.5">
                      {previaMulta(relTarget.years).porAno.map((y) => (
                        <li key={y.label} className="flex justify-between tabular-nums">
                          <span>{y.label}</span>
                          <span className="text-amber-600 dark:text-amber-400">
                            {fmtMoney(y.amount)}
                          </span>
                        </li>
                      ))}
                      <li className="mt-1 flex justify-between border-t border-border pt-1 font-semibold tabular-nums">
                        <span>Total</span>
                        <span>{fmtMoney(relTarget.multaTotal)}</span>
                      </li>
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem multa prevista (salário na faixa isenta).
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button onClick={() => void confirmarDispensa()} disabled={submitting}>
              {submitting ? "Enviando..." : "Propor dispensa"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de IR */}
      <AlertDialog
        open={!!irTarget}
        onOpenChange={(o) => {
          if (!submitting && !o) {
            setIrTarget(null);
            setIrChoice(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pôr {irTarget?.name} em IR?</AlertDialogTitle>
            <AlertDialogDescription>
              Escolha o tipo de IR. A proposta vai para a fila do admin, que decide se o pedido é
              válido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            {(["partial", "out_of_season"] as IrType[]).map((t) => (
              <label
                key={t}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors",
                  irChoice === t
                    ? "border-[color:var(--court)] bg-muted/40"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <input
                  type="radio"
                  name="ir-type"
                  value={t}
                  checked={irChoice === t}
                  onChange={() => setIrChoice(t)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{IR_TYPE_LABEL[t]}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {IR_TYPE_RULE[t]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button onClick={() => void confirmarIr()} disabled={submitting || !irChoice}>
              {submitting ? "Enviando..." : "Solicitar IR"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
