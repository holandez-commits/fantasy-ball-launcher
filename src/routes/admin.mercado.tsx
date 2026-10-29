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
  fmtDateTime,
  TX_TYPE_LABEL,
  IR_TYPE_LABEL,
  irTypeLabel,
  type CurrentSeason,
  type IrType,
} from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ir_type: string | null;
  proposerName: string | null;
  teamName: string | null;
  playerName: string | null;
  multaResumo: string | null;
  tradeItems: TradeItemView[] | null;
};

type IrRow = {
  playerId: string;
  name: string;
  position: string | null;
  teamName: string | null;
  irSince: number | null;
  irType: string | null;
};

type SigningRow = { entryId: string; name: string; teamName: string | null };
type PreviaLeilao = {
  playerId: string;
  playerName: string;
  teamName: string;
  salary: number;
  position: string | null;
  /** jogador novo (lance em nome que não estava no banco): admin define nome/posição/ESPN antes de consolidar */
  isPending: boolean;
  pendingPosition: string | null;
  espnId: string | null;
};

const NOVO_POSICOES = ["PG", "SG", "SF", "PF", "C", "PG/SG", "SG/SF", "SF/PF", "PF/C"];
type PreviaCons = { fase: string; detalhe: string };

type IrPainelRow = {
  player_id: string;
  full_name: string;
  position: string | null;
  team_id: string;
  team_name: string;
  team_slug: string;
  ir_since: string;
  dias: number;
  desde_inicio: boolean;
  ativos: number;
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
  const [irTypeChoice, setIrTypeChoice] = useState<Record<string, IrType>>({});
  const [leilaoWeek, setLeilaoWeek] = useState<number | null>(null);
  const [signings, setSignings] = useState<SigningRow[]>([]);
  const [posInputs, setPosInputs] = useState<Record<string, string>>({});
  const [prevLeilao, setPrevLeilao] = useState<PreviaLeilao[] | null>(null);
  const [novoEdits, setNovoEdits] = useState<Record<string, { name?: string; pos?: string; espn?: string }>>({});
  const [prevCons, setPrevCons] = useState<PreviaCons[] | null>(null);

  const [toggling, setToggling] = useState(false);
  const [auto, setAuto] = useState<{ enabled: boolean; last_run_at: string | null; last_run_result: string | null } | null>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [irPainel, setIrPainel] = useState<IrPainelRow[] | null>(null);
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

      const txRes = await db
        .from("transactions")
        .select("id, type, status, week_number, proposed_by, created_at, ir_type")
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

      const irRes = await db
        .from("roster_entries")
        .select("id, player_id, position, ir_since_season, ir_type, team_id, player:players(full_name)")
        .eq("season", cur.start_year)
        .eq("status", "injured_reserve");
      if (irRes.error) throw new Error(irRes.error.message);
      const irEntries = (irRes.data ?? []) as {
        player_id: string;
        position: string | null;
        ir_since_season: number | null;
        ir_type: string | null;
        team_id: string;
        player: { full_name: string } | null;
      }[];

      // signings sem posição (contratações do leilão nascem com position NULL)
      const sgRes = await db
        .from("roster_entries")
        .select("id, team_id, player:players(full_name), team:teams(name)")
        .eq("season", cur.start_year)
        .eq("acquired_via", "signing")
        .is("position", null);
      const sgEntries = (sgRes.data ?? []) as {
        id: string;
        team_id: string;
        player: { full_name: string } | null;
        team: { name: string } | null;
      }[];
      setSignings(
        sgEntries.map((e) => ({
          entryId: e.id,
          name: e.player?.full_name ?? "—",
          teamName: e.team?.name ?? null,
        })),
      );

      // semana do leilão/consolidação = semana travada mais recente (roster_locks)
      const wkRes = await db
        .from("roster_locks")
        .select("week_number")
        .eq("season_id", cur.id)
        .order("week_number", { ascending: false })
        .limit(1);
      setLeilaoWeek((wkRes.data as { week_number: number }[] | null)?.[0]?.week_number ?? null);

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
              .select("id, round, season:seasons!draft_picks_draft_season_id_fkey(label), original_team:teams!draft_picks_original_team_id_fkey(name)")
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
          (picksRes.data ?? []) as {
            id: string;
            round: number;
            season: { label: string } | null;
            original_team: { name: string } | null;
          }[]
        ).map((p) => [
          p.id,
          `Pick ${p.round}ª · ${p.season?.label ?? "—"} · de ${p.original_team?.name ?? "—"}`,
        ]),
      );

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
            irType: e.ir_type,
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

  const loadAuto = useCallback(async () => {
    const { data, error } = await callRpc("get_market_auto_close");
    if (!error && data) setAuto(data as NonNullable<typeof auto>);
  }, []);

  useEffect(() => {
    if (ready) void loadAuto();
  }, [ready, loadAuto]);

  const loadIrPainel = useCallback(async () => {
    const { data, error } = await callRpc("get_ir_parcial_painel");
    if (!error && data) setIrPainel(data as IrPainelRow[]);
  }, []);

  useEffect(() => {
    if (ready) void loadIrPainel();
  }, [ready, loadIrPainel]);

  async function toggleAuto() {
    if (!auto) return;
    setTogglingAuto(true);
    setResult(null);
    const { data, error } = await callRpc("set_market_auto_close", { _enabled: !auto.enabled });
    setTogglingAuto(false);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Atualizado." });
      await loadAuto();
    }
  }

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
    const args: Record<string, unknown> = { _tx_id: tx.id };
    if (tx.type === "ir") {
      // o admin decide se a solicitação é válida e pode ajustar o tipo ao executar
      const t = irTypeChoice[tx.id] ?? tx.ir_type;
      if (t) args._ir_type = t;
    }
    const { data, error } = await callRpc(fn, args);
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

  async function verPreviaLeilao() {
    if (leilaoWeek == null || !season) return;
    setBusyId("prev-leilao");
    setResult(null);
    const { data, error } = await callRpc("leilao_previa", {
      _season_id: season.id,
      _week: leilaoWeek,
    });
    if (error) {
      setBusyId(null);
      setResult({ ok: false, message: error.message });
      return;
    }
    const rows = (data ?? []) as {
      player_id: string;
      player_name: string;
      team_name: string;
      salary_offer: number;
    }[];
    // posição = última conhecida do jogador (mesma lógica do auto-preenchimento do signing)
    const ids = [...new Set(rows.map((r) => r.player_id))];
    const posByPlayer: Record<string, string> = {};
    if (ids.length > 0) {
      const posRes = await db
        .from("roster_entries")
        .select("player_id, position, season")
        .in("player_id", ids)
        .not("position", "is", null)
        .order("season", { ascending: false });
      for (const e of (posRes.data ?? []) as {
        player_id: string;
        position: string | null;
        season: number;
      }[]) {
        if (e.position && !(e.player_id in posByPlayer)) posByPlayer[e.player_id] = e.position;
      }
    }
    // jogadores novos (pendentes): nome "oficial" + posição/ESPN já definidos
    const pendById: Record<
      string,
      { full_name: string; is_pending: boolean; pending_position: string | null; espn_id: string | null }
    > = {};
    if (ids.length > 0) {
      const plRes = await db
        .from("players")
        .select("id, full_name, is_pending, pending_position, espn_id")
        .in("id", ids);
      for (const p of (plRes.data ?? []) as {
        id: string;
        full_name: string;
        is_pending: boolean;
        pending_position: string | null;
        espn_id: string | null;
      }[]) {
        pendById[p.id] = p;
      }
    }
    setBusyId(null);
    setPrevLeilao(
      rows.map((r) => {
        const pl = pendById[r.player_id];
        return {
          playerId: r.player_id,
          playerName: pl?.full_name ?? r.player_name,
          teamName: r.team_name,
          salary: r.salary_offer,
          position: pl?.is_pending ? (pl.pending_position ?? null) : (posByPlayer[r.player_id] ?? null),
          isPending: !!pl?.is_pending,
          pendingPosition: pl?.pending_position ?? null,
          espnId: pl?.espn_id ?? null,
        };
      }),
    );
  }

  async function salvarNovo(r: PreviaLeilao) {
    const ed = novoEdits[r.playerId] ?? {};
    const name = (ed.name ?? r.playerName).trim();
    const pos = ed.pos ?? r.pendingPosition ?? "";
    const espn = ed.espn ?? r.espnId ?? "";
    if (!pos) {
      setResult({ ok: false, message: `Escolha a posição de ${name}.` });
      return;
    }
    setBusyId("novo:" + r.playerId);
    setResult(null);
    const { data, error } = await callRpc("set_novo_jogador", {
      _player_id: r.playerId,
      _full_name: name,
      _position: pos,
      _espn_id: espn.trim() || null,
    });
    setBusyId(null);
    if (error) {
      setResult({ ok: false, message: error.message });
      return;
    }
    setResult({ ok: true, message: typeof data === "string" ? data : "Jogador novo atualizado." });
    setNovoEdits((cur) => {
      const next = { ...cur };
      delete next[r.playerId];
      return next;
    });
    await verPreviaLeilao();
  }

  async function commitLeilao() {
    if (leilaoWeek == null || !season) return;
    setBusyId("commit-leilao");
    setResult(null);
    const { data, error } = await callRpc("leilao_commit", {
      _season_id: season.id,
      _week: leilaoWeek,
    });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Leilão consolidado." });
      setPrevLeilao(null);
      void load();
    }
  }

  async function definirPosicao(entryId: string) {
    const pos = (posInputs[entryId] ?? "").trim();
    if (!pos) {
      setResult({ ok: false, message: "Informe a posição." });
      return;
    }
    setBusyId("pos:" + entryId);
    setResult(null);
    const { data, error } = await callRpc("set_signing_position", {
      _roster_entry_id: entryId,
      _position: pos,
    });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Posição definida." });
      void load();
    }
  }

  async function verPreviaCons() {
    if (leilaoWeek == null) {
      setResult({ ok: false, message: "Nenhuma semana travada pra prévia do leilão." });
      return;
    }
    setBusyId("prev-cons");
    setResult(null);
    const { data, error } = await callRpc("consolidar_mercado_previa", { _week: leilaoWeek });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else
      setPrevCons(
        ((data ?? []) as PreviaCons[]).map((r) => ({
          fase: r.fase,
          // Encurta uuids crus (ex. "tx 1a2b3c4d-...-...") pra "tx #1a2b3c4d".
          detalhe: String(r.detalhe ?? "").replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            (m) => "#" + m.slice(0, 8),
          ),
        })),
      );
  }

  async function commitCons() {
    if (leilaoWeek == null) {
      setResult({ ok: false, message: "Nenhuma semana travada." });
      return;
    }
    setBusyId("commit-cons");
    setResult(null);
    const { data, error } = await callRpc("consolidar_mercado_commit", { _week: leilaoWeek });
    setBusyId(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Consolidado." });
      setPrevCons(null);
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
        {t.type === "ir" && irTypeLabel(t.ir_type) && (
          <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            {irTypeLabel(t.ir_type)}
          </span>
        )}
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
        Abra/feche o mercado, decida a fila, execute movimentações, rode o leilão e a consolidação
        de domingo.
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
              Fechado = período de lances de FA; a consolidação de domingo processa a fila, roda o
              leilão e reabre.
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
        {auto && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <div className="text-sm font-medium">
                Fechamento automático (todo sábado, 00:00):{" "}
                {auto.enabled ? (
                  <span className="text-emerald-600 dark:text-emerald-400">ATIVO</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">PAUSADO</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pause fora da temporada. Se o mercado já estiver fechado, nada acontece.
                {auto.last_run_at && (
                  <>
                    {" "}
                    Última execução: {fmtDateTime(auto.last_run_at)} — {auto.last_run_result}
                  </>
                )}
              </p>
            </div>
            <Button variant="outline" onClick={() => void toggleAuto()} disabled={togglingAuto}>
              {togglingAuto ? "Alterando..." : auto.enabled ? "Pausar" : "Reativar"}
            </Button>
          </div>
        )}
      </section>

      {/* IR parcial: tempo sem reativar */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">IR parcial: há quanto tempo estão fora</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Do mais antigo para o mais novo. O GM pede a volta em /mercado; sem vaga (15 ativos), precisa dispensar
          alguém antes. “Desde o início” = já estava no IR na importação do elenco (a data real não existe).
        </p>
        {irPainel === null ? (
          <Skeleton className="mt-3 h-20 w-full" />
        ) : irPainel.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum jogador em IR parcial.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Jogador</th>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-right">Dias no IR</th>
                  <th className="px-3 py-2 text-left">Desde</th>
                  <th className="px-3 py-2 text-left">Elenco</th>
                </tr>
              </thead>
              <tbody>
                {irPainel.map((r) => (
                  <tr key={r.player_id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {r.full_name}
                      {r.position && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.position}</span>}
                    </td>
                    <td className="px-3 py-2">{r.team_name}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.dias}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.desde_inicio ? "desde o início" : fmtDateTime(r.ir_since)}
                    </td>
                    <td className="px-3 py-2">
                      {r.ativos >= 15 ? (
                        <span className="text-amber-600 dark:text-amber-400">{r.ativos}/15 · sem vaga</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">{r.ativos}/15 · tem vaga</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                    <div className="flex flex-wrap items-center gap-2">
                      {t.type === "ir" && (
                        <select
                          aria-label="Tipo de IR"
                          value={irTypeChoice[t.id] ?? (t.ir_type as IrType | null) ?? "partial"}
                          onChange={(e) =>
                            setIrTypeChoice((m) => ({ ...m, [t.id]: e.target.value as IrType }))
                          }
                          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                        >
                          <option value="partial">{IR_TYPE_LABEL.partial}</option>
                          <option value="out_of_season">{IR_TYPE_LABEL.out_of_season}</option>
                        </select>
                      )}
                      <Button size="sm" onClick={() => void executar(t)} disabled={busyId === t.id}>
                        {busyId === t.id ? "Executando..." : EXEC_LABEL[t.type] ?? "Executar"}
                      </Button>
                    </div>
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
              IR parcial: pode voltar a qualquer momento, se houver vaga (com 15 ativos, o time
              precisa dispensar ou trocar alguém antes); o cap não muda. IR fora da temporada: só a
              partir da temporada seguinte, e o salário volta a contar 100%. "Forçar" fura cap e
              vaga (override).
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
                          {irTypeLabel(r.irType) ? ` · ${irTypeLabel(r.irType)}` : ""}
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

          {/* Leilão */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">
              Leilão{leilaoWeek != null ? ` — semana ${leilaoWeek}` : ""}
            </h2>
            {leilaoWeek == null ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma semana travada (`roster_locks`) — leilão indisponível.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void verPreviaLeilao()}
                    disabled={busyId === "prev-leilao"}
                  >
                    {busyId === "prev-leilao" ? "..." : "Ver prévia do leilão"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void commitLeilao()}
                    disabled={busyId === "commit-leilao"}
                  >
                    {busyId === "commit-leilao" ? "..." : "Processar só o leilão"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Lance em jogador que não estava no banco aparece na prévia como <strong>novo</strong>: confira o
                  nome, defina a <strong>posição</strong> (obrigatória) e, se souber, o ESPN id antes de consolidar.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  "Processar só o leilão" cria os signings mas NÃO processa a fila nem reabre o
                  mercado — no domingo, use a consolidação abaixo.
                </p>
                {prevLeilao &&
                  (prevLeilao.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Nenhum vencedor projetado.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                      {prevLeilao.map((r, i) =>
                        r.isPending ? (
                          <li key={i} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                <span className="mr-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                  novo
                                </span>
                                <span className="font-medium">{r.playerName}</span> →{" "}
                                <span className="font-medium">{r.teamName}</span>
                              </span>
                              <span className="tabular-nums">{fmtMoney(r.salary)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Input
                                value={novoEdits[r.playerId]?.name ?? r.playerName}
                                onChange={(e) =>
                                  setNovoEdits((cur) => ({
                                    ...cur,
                                    [r.playerId]: { ...cur[r.playerId], name: e.target.value },
                                  }))
                                }
                                className="w-52"
                                aria-label="Nome do jogador"
                              />
                              <select
                                value={novoEdits[r.playerId]?.pos ?? r.pendingPosition ?? ""}
                                onChange={(e) =>
                                  setNovoEdits((cur) => ({
                                    ...cur,
                                    [r.playerId]: { ...cur[r.playerId], pos: e.target.value },
                                  }))
                                }
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                aria-label="Posição"
                              >
                                <option value="">Posição…</option>
                                {NOVO_POSICOES.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                              <Input
                                value={novoEdits[r.playerId]?.espn ?? r.espnId ?? ""}
                                onChange={(e) =>
                                  setNovoEdits((cur) => ({
                                    ...cur,
                                    [r.playerId]: { ...cur[r.playerId], espn: e.target.value },
                                  }))
                                }
                                placeholder="ESPN id (opcional)"
                                className="w-40"
                                aria-label="ESPN id"
                              />
                              <Button
                                size="sm"
                                onClick={() => void salvarNovo(r)}
                                disabled={busyId === "novo:" + r.playerId}
                              >
                                {busyId === "novo:" + r.playerId ? "..." : "Salvar"}
                              </Button>
                              {!r.pendingPosition && (
                                <span className="text-xs text-amber-700 dark:text-amber-400">
                                  sem posição — a consolidação fica bloqueada
                                </span>
                              )}
                            </div>
                          </li>
                        ) : (
                          <li key={i} className="flex justify-between">
                            <span>
                              {r.playerName}
                              {r.position ? (
                                <span className="text-muted-foreground"> ({r.position})</span>
                              ) : (
                                ""
                              )}{" "}
                              → <span className="font-medium">{r.teamName}</span>
                            </span>
                            <span className="tabular-nums">{fmtMoney(r.salary)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  ))}
              </>
            )}
          </section>

          {/* Definir posição dos signings */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">
              Contratações sem posição{signings.length > 0 ? ` (${signings.length})` : ""}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Signings do leilão nascem sem posição. Defina (ex.: <code>PG</code> ou{" "}
              <code>PG/SG</code>) pra o jogador ser escalável nos slots posicionais.
            </p>
            {signings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma contratação aguardando posição.</p>
            ) : (
              <div className="space-y-3">
                {signings.map((s) => (
                  <div
                    key={s.entryId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{s.teamName ?? "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="ex: PG"
                        value={posInputs[s.entryId] ?? ""}
                        onChange={(e) =>
                          setPosInputs((cur) => ({ ...cur, [s.entryId]: e.target.value }))
                        }
                        className="w-28"
                      />
                      <Button
                        size="sm"
                        onClick={() => void definirPosicao(s.entryId)}
                        disabled={busyId === "pos:" + s.entryId}
                      >
                        {busyId === "pos:" + s.entryId ? "..." : "Definir"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Consolidação de domingo */}
          <section className="mt-12">
            <h2 className="mb-2 font-display text-xl tracking-tight">
              Consolidação de domingo{leilaoWeek != null ? ` — semana ${leilaoWeek}` : ""}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Processa a fila de dispensas/trocas aprovadas (FIFO), resolve o leilão e REABRE o
              mercado. Só roda com o mercado fechado.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void verPreviaCons()}
                disabled={busyId === "prev-cons"}
              >
                {busyId === "prev-cons" ? "..." : "Ver prévia"}
              </Button>
              <Button
                size="sm"
                onClick={() => void commitCons()}
                disabled={busyId === "commit-cons"}
              >
                {busyId === "commit-cons" ? "..." : "Consolidar o domingo (fila + leilão)"}
              </Button>
            </div>
            {prevCons &&
              (prevCons.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nada a consolidar.</p>
              ) : (
                <ul className="mt-3 space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
                  {prevCons.map((r, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {r.fase}
                      </span>
                      <span>{r.detalhe}</span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        </>
      )}
    </Shell>
  );
}
