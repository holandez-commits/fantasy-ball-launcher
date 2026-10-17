import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import {
  db,
  callRpc,
  fmtMoney,
  fmtMultaResumo,
  previaMulta,
  fetchCurrentSeason,
  fetchMarketOpen,
  TX_TYPE_LABEL,
  type CurrentSeason,
} from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/mercado")({
  head: () => ({
    meta: [
      { title: "Mercado — Admin — Liga Bola Presa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminMercadoPage,
});

type Item = {
  transaction_id: string;
  asset_type: string;
  player_id: string | null;
  pick_id: string | null;
  from_team_id: string | null;
  to_team_id: string | null;
  amount: number | null;
};

type TradeItemView = { label: string; fromName: string; toName: string };

type TxRow = {
  id: string;
  type: string;
  status: string;
  week_number: number | null;
  proposed_by: string | null;
  created_at: string;
  proposerName: string | null;
  teamName: string | null; // release/ir
  playerName: string | null; // release/ir
  multaResumo: string | null; // release
  tradeItems: TradeItemView[] | null; // trade
};

type IrRow = {
  playerId: string;
  name: string;
  position: string | null;
  teamName: string | null;
  irSince: number | null;
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

const EXEC_LABEL: Record<string, string> = {
  release: "Executar dispensa",
  ir: "Executar IR",
  trade: "Executar troca",
};

function AdminMercadoPage() {
  const { ready, forbidden } = useRequireAuth({ role: "admin" });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [fila, setFila] = useState<TxRow[]>([]);
  const [aprovadas, setAprovadas] = useState<TxRow[]>([]);
  const [irRows, setIrRows] = useState<IrRow[]>([]);

  const [toggling, setToggling] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
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

      // proposed (release/ir), accepted (trade pronta p/ admin) e approved (aguardando execução)
      const txRes = await db
        .from("transactions")
        .select("id, type, status, week_number, proposed_by, created_at")
        .in("status", ["proposed", "accepted", "approved"])
        .order("created_at", { ascending: true });
      if (txRes.error) throw new Error(txRes.error.message);
      const txs = (txRes.data ?? []) as Omit<
        TxRow,
        "proposerName" | "teamName" | "playerName" | "multaResumo" | "tradeItems"
      >[];

      const txIds = txs.map((t) => t.id);
      let items: Item[] = [];
      if (txIds.length > 0) {
        const itRes = await db
          .from("transaction_items")
          .select(
            "transaction_id, asset_type, player_id, pick_id, from_team_id, to_team_id, amount",
          )
          .in("transaction_id", txIds);
        if (itRes.error) throw new Error(itRes.error.message);
        items = (itRes.data ?? []) as Item[];
      }

      // Jogadores em IR (todos os times) — pra seção de reativação.
      const irRes = await db
        .from("roster_entries")
        .select("id, player_id, position, ir_since_season, team_id, player:players(full_name)")
        .eq("season", cur.start_year)
        .eq("status", "injured_reserve");
      if (irRes.error) throw new Error(irRes.error.message);
      const irEntries = (irRes.data ?? []) as {
        player_id: string;
        position: string | null;
        ir_since_season: number | null;
        team_id: string;
        player: { full_name: string } | null;
      }[];

      // Nomes
      const gmIds = [...new Set(txs.map((t) => t.proposed_by).filter(Boolean) as string[])];
      const teamIds = [
        ...new Set([
          ...(items.flatMap((i) => [i.from_team_id, i.to_team_id]).filter(Boolean) as string[]),
          ...irEntries.map((e) => e.team_id),
        ]),
      ];
      const playerIds = [
        ...new Set([
          ...(items.map((i) => i.player_id).filter(Boolean) as string[]),
          ...irEntries.map((e) => e.player_id),
        ]),
      ];
      const pickIds = [...new Set(items.map((i) => i.pick_id).filter(Boolean) as string[])];

      const [gmsRes, teamsRes, playersRes, picksRes] = await Promise.all([
        gmIds.length ? db.from("gms").select("id, full_name").in("id", gmIds) : { data: [] },
        teamIds.length ? db.from("teams").select("id, name").in("id", teamIds) : { data: [] },
        playerIds.length
          ? db.from("players").select("id, full_name").in("id", playerIds)
          : { data: [] },
        pickIds.length
          ? db
              .from("draft_picks")
              .select("id, round, season:seasons!draft_picks_draft_season_id_fkey(label)")
              .in("id", pickIds)
          : { data: [] },
      ]);
      const gmName = Object.fromEntries(
        ((gmsRes.data ?? []) as { id: string; full_name: string }[]).map((g) => [g.id, g.full_name]),
      );
      const teamName = Object.fromEntries(
        ((teamsRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
      );
      const playerName = Object.fromEntries(
        ((playersRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [
          p.id,
          p.full_name,
        ]),
      );
      const pickLabel = Object.fromEntries(
        (
          (picksRes.data ?? []) as { id: string; round: number; season: { label: string } | null }[]
        ).map((p) => [p.id, `Pick ${p.round}ª · ${p.season?.label ?? "—"}`]),
      );

      // Multa estimada das dispensas
      const releasePlayerItems = items.filter(
        (i) =>
          i.asset_type === "player" &&
          i.player_id &&
          i.from_team_id &&
          txs.find((t) => t.id === i.transaction_id)?.type === "release",
      );
      const multaByTx: Record<string, string> = {};
      if (releasePlayerItems.length > 0) {
        const rTeamIds = [...new Set(releasePlayerItems.map((i) => i.from_team_id!) as string[])];
        const rPlayerIds = [...new Set(releasePlayerItems.map((i) => i.player_id!) as string[])];
        const entRes = await db
          .from("roster_entries")
          .select("id, team_id, player_id")
          .eq("season", cur.start_year)
          .in("team_id", rTeamIds)
          .in("player_id", rPlayerIds);
        const entries = (entRes.data ?? []) as {
          id: string;
          team_id: string;
          player_id: string;
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
        const entryOf = (teamId: string, playerId: string) =>
          entries.find((e) => e.team_id === teamId && e.player_id === playerId);
        for (const it of releasePlayerItems) {
          const ent = entryOf(it.from_team_id!, it.player_id!);
          if (!ent) continue;
          const years = cy
            .filter((c) => c.roster_entry_id === ent.id)
            .map((c) => ({ season_label: c.season_label, salary: c.salary }));
          multaByTx[it.transaction_id] = fmtMultaResumo(previaMulta(years));
        }
      }

      const itemLabel = (i: Item): string =>
        i.asset_type === "player"
          ? i.player_id
            ? playerName[i.player_id] ?? "—"
            : "—"
          : i.asset_type === "pick"
            ? i.pick_id
              ? pickLabel[i.pick_id] ?? "Pick"
              : "Pick"
            : `Multa ${fmtMoney(i.amount ?? 0)}`;

      const enrich = (
        t: Omit<
          TxRow,
          "proposerName" | "teamName" | "playerName" | "multaResumo" | "tradeItems"
        >,
      ): TxRow => {
        const myItems = items.filter((i) => i.transaction_id === t.id);
        const playerItem = myItems.find((i) => i.asset_type === "player");
        const fromTeam = playerItem?.from_team_id ?? null;
        return {
          ...t,
          proposerName: t.proposed_by ? gmName[t.proposed_by] ?? null : null,
          teamName: fromTeam ? teamName[fromTeam] ?? null : null,
          playerName: playerItem?.player_id ? playerName[playerItem.player_id] ?? null : null,
          multaResumo: t.type === "release" ? multaByTx[t.id] ?? "sem multa" : null,
          tradeItems:
            t.type === "trade"
              ? myItems.map((i) => ({
                  label: itemLabel(i),
                  fromName: i.from_team_id ? teamName[i.from_team_id] ?? "—" : "—",
                  toName: i.to_team_id ? teamName[i.to_team_id] ?? "—" : "—",
                }))
              : null,
        };
      };

      const enriched = txs.map(enrich);
      // Fila do admin: release/ir em 'proposed' + trade em 'accepted'
      setFila(
        enriched.filter(
          (t) =>
            (t.status === "proposed" && (t.type === "release" || t.type === "ir")) ||
            (t.status === "accepted" && t.type === "trade"),
        ),
      );
      setAprovadas(
        enriched.filter(
          (t) =>
            t.status === "approved" &&
            (t.type === "release" || t.type === "ir" || t.type === "trade"),
        ),
      );
      setIrRows(
        irEntries
          .map((e) => ({
            playerId: e.player_id,
            name: e.player?.full_name ?? "—",
            position: e.position,
            teamName: teamName[e.team_id] ?? null,
            irSince: e.ir_since_season,
          }))
          .sort((a, b) => (a.teamName ?? "").localeCompare(b.teamName ?? "")),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar a fila do mercado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function toggleMarket() {
    if (marketOpen === null) return;
    setToggling(true);
    setResult(null);
    const { data, error } = await callRpc("set_market_open", { _is_open: !marketOpen });
    setToggling(false);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Estado alterado." });
      setMarketOpen(!marketOpen);
    }
  }

  async function decidir(txId: string, aceitar: boolean, override = false) {
    setBusyId(txId);
    setResult(null);
    const { data, error } = await callRpc("decidir_transacao", {
      _tx_id: txId,
      _aceitar: aceitar,
      _override: override,
    });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Decisão registrada." });
      void load();
    }
  }

  async function executar(tx: TxRow) {
    const fn =
      tx.type === "ir" ? "executar_ir" : tx.type === "trade" ? "executar_troca" : "executar_dispensa";
    setBusyId(tx.id);
    setResult(null);
    const { data, error } = await callRpc(fn, { _tx_id: tx.id });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Executado." });
      void load();
    }
  }

  async function reativar(playerId: string, override: boolean) {
    setBusyId("ir:" + playerId);
    setResult(null);
    const { data, error } = await callRpc("reativar_ir", {
      _player_id: playerId,
      _override: override,
    });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "IR reativado." });
      void load();
    }
  }

  if (forbidden) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta área é restrita a administradores da liga.
        </p>
      </Shell>
    );
  }
  if (!ready) return null;

  const TxMeta = ({ t }: { t: TxRow }) => (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {TX_TYPE_LABEL[t.type] ?? t.type}
        </span>
        {t.type === "trade" ? (
          <span>{t.proposerName ? `Proposta de ${t.proposerName}` : "Troca"}</span>
        ) : (
          <span>{t.playerName ?? "—"}</span>
        )}
      </div>
      {t.type === "trade" && t.tradeItems ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {t.tradeItems.map((it, i) => (
            <li key={i}>
              {it.label}: {it.fromName} → {it.toName}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t.teamName ?? "—"}
          {t.proposerName ? ` · por ${t.proposerName}` : ""}
          {t.multaResumo ? ` · multa ${t.multaResumo}` : ""}
        </div>
      )}
    </div>
  );

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Admin · Temporada {season?.label ?? ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Mercado</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Abra/feche o mercado, aprove ou recuse propostas, execute dispensas, trocas e IR, e reative
        lesionados.
      </p>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Feito" : "Erro"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* Toggle do mercado */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              Estado do mercado:{" "}
              {marketOpen === null ? (
                <span className="text-muted-foreground">—</span>
              ) : marketOpen ? (
                <span className="text-emerald-600 dark:text-emerald-400">ABERTO</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">FECHADO</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fechado = período de lances de FA; dispensas/trocas aprovadas ficam pra consolidação
              de domingo.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void toggleMarket()}
            disabled={toggling || marketOpen === null}
          >
            {toggling ? "Alterando..." : marketOpen ? "Fechar mercado" : "Abrir mercado"}
          </Button>
        </div>
      </section>

      {loading ? (
        <>
          <Skeleton className="mt-8 h-8 w-40" />
          <Skeleton className="mt-4 h-48 w-full" />
        </>
      ) : (
        <>
          {/* Fila de aprovação */}
          <section className="mt-10">
            <h2 className="mb-4 font-display text-xl tracking-tight">
              Fila de aprovação{fila.length > 0 ? ` (${fila.length})` : ""}
            </h2>
            {fila.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada pendente.</p>
            ) : (
              <div className="space-y-3">
                {fila.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <TxMeta t={t} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void decidir(t.id, true)}
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? "..." : "Aprovar"}
                      </Button>
                      {t.type === "trade" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void decidir(t.id, true, true)}
                          disabled={busyId === t.id}
                          title="Aprova furando cap/vaga no commit"
                        >
                          Aprovar c/ override
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void decidir(t.id, false)}
                        disabled={busyId === t.id}
                      >
                        Recusar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Aprovadas aguardando execução */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">
              Aprovadas aguardando execução{aprovadas.length > 0 ? ` (${aprovadas.length})` : ""}
            </h2>
            {marketOpen === false && aprovadas.length > 0 && (
              <Alert className="mb-3">
                <AlertDescription className="text-xs">
                  Mercado fechado: o fluxo normal é deixar a consolidação de domingo executar.
                  Executar agora é exceção.
                </AlertDescription>
              </Alert>
            )}
            {aprovadas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma aprovada aguardando.</p>
            ) : (
              <div className="space-y-3">
                {aprovadas.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <TxMeta t={t} />
                    <Button size="sm" onClick={() => void executar(t)} disabled={busyId === t.id}>
                      {busyId === t.id ? "Executando..." : EXEC_LABEL[t.type] ?? "Executar"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Reativação de IR */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">
              Jogadores em IR{irRows.length > 0 ? ` (${irRows.length})` : ""}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              A reativação só é permitida a partir da temporada seguinte à do IR. "Forçar" fura cap
              e vaga (override).
            </p>
            {irRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum jogador em IR.</p>
            ) : (
              <div className="space-y-3">
                {irRows.map((r) => {
                  const busy = busyId === "ir:" + r.playerId;
                  return (
                    <div
                      key={r.playerId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.teamName ?? "—"}
                          {r.position ? ` · ${r.position}` : ""}
                          {r.irSince != null ? ` · em IR desde ${r.irSince}` : ""}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void reativar(r.playerId, false)}
                          disabled={busy}
                        >
                          {busy ? "..." : "Reativar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void reativar(r.playerId, true)}
                          disabled={busy}
                        >
                          Forçar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
