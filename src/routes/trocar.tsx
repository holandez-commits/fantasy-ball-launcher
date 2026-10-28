import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import {
  db,
  callRpc,
  fmtMoney,
  fetchCurrentSeason,
  fetchMarketOpen,
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

export const Route = createFileRoute("/trocar")({
  head: () => ({
    meta: [
      { title: "Propor troca — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrocarPage,
});

const PENALTY_MIN = 50_000;

type TeamLite = { id: string; name: string };
type PlayerAsset = {
  kind: "player";
  id: string;
  name: string;
  position: string | null;
  salary: number;
  espnId: string | null;
};
type PickAsset = { kind: "pick"; id: string; label: string; origin: string | null };
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

const akey = (a: Asset) => `${a.kind}:${a.id}`;

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

function defaultDeadline(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [allTeams, setAllTeams] = useState<TeamLite[]>([]);
  const [assetsByTeam, setAssetsByTeam] = useState<Record<string, TeamAssets>>({});

  const [otherIds, setOtherIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, Sel>>({});
  const [deadline, setDeadline] = useState<string>(defaultDeadline());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    setSelected((cur) => ({ ...cur, [k]: { ...cur[k], to } }));
  }
  function setAmount(k: string, amount: string) {
    setSelected((cur) => ({ ...cur, [k]: { ...cur[k], amount } }));
  }

  const count = Object.keys(selected).length;

  async function propor() {
    if (!teamId) return;
    const itens: Record<string, unknown>[] = [];
    for (const [k, sel] of Object.entries(selected)) {
      const [kind, id] = k.split(":");
      if (!sel.to) {
        setResult({ ok: false, message: "Todo item precisa de um time de destino." });
        return;
      }
      if (sel.to === sel.from) {
        setResult({ ok: false, message: "Item com origem igual ao destino." });
        return;
      }
      if (kind === "player") {
        itens.push({ asset_type: "player", player_id: id, from_team_id: sel.from, to_team_id: sel.to });
      } else if (kind === "pick") {
        itens.push({ asset_type: "pick", pick_id: id, from_team_id: sel.from, to_team_id: sel.to });
      } else {
        const amt = Math.round(Number(sel.amount));
        if (!amt || amt < PENALTY_MIN) {
          setResult({ ok: false, message: `Multa mínima por ano é ${fmtMoney(PENALTY_MIN)} (enviado).` });
          return;
        }
        const asset = assetsByTeam[sel.from]?.penalties.find((p) => p.id === id);
        if (!asset) {
          setResult({ ok: false, message: "Multa não encontrada. Recarregue a página." });
          return;
        }
        if (amt > asset.saldo) {
          setResult({ ok: false, message: `${asset.label}: valor acima do saldo (${fmtMoney(asset.saldo)}).` });
          return;
        }
        // reparte o valor do ano entre as linhas de origem (maiores primeiro)
        let left = amt;
        for (const part of asset.parts) {
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
    if (itens.length === 0) {
      setResult({ ok: false, message: "Selecione ao menos um ativo pra trocar." });
      return;
    }

    const deadlineISO = deadline ? new Date(deadline).toISOString() : null;
    setSubmitting(true);
    setResult(null);
    const { error } = await callRpc("propor_troca", {
      _itens: itens,
      _week: null,
      _accept_deadline: deadlineISO,
    });
    setSubmitting(false);
    if (error) {
      setResult({ ok: false, message: error.message });
    } else {
      setResult({ ok: true, message: "Troca proposta! Aguardando o aceite dos outros times." });
      setSelected({});
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
        <h1 className="font-display text-3xl">Propor troca</h1>
        <Alert className="mt-6">
          <AlertDescription>Sua conta não tem time associado.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const addable = allTeams.filter((t) => t.id !== teamId && !otherIds.includes(t.id));

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
      <p className="mt-2 text-sm text-muted-foreground">
        Envolva 2 ou mais times. Marque, por time, o que cada um envia (jogador, pick ou fatia de
        multa) e pra quem. Cap e vagas são checados já na proposta.
      </p>

      <div className="mt-6">
        <MarketStateBanner isOpen={marketOpen} />
      </div>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Proposta enviada" : "Não foi possível propor"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {loading ? (
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
                  <option value="">+ adicionar time</option>
                  {addable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </section>

          {/* Painel por time: o que ele envia */}
          {otherIds.length === 0 ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Adicione ao menos um outro time pra montar a troca.
            </p>
          ) : (
            <div className="mt-6 space-y-6">
              {participating.map((tid) => (
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
                />
              ))}
            </div>
          )}

          {otherIds.length > 0 && (
            <div className="mt-8 flex flex-wrap items-end gap-4">
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
              <Button onClick={() => void propor()} disabled={submitting || count === 0}>
                {submitting ? "Enviando..." : `Propor troca (${count})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Shell>
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
}) {
  const dests = participating.filter((t) => t !== teamId);
  const all: Asset[] = assets
    ? [...assets.players, ...assets.picks, ...assets.penalties]
    : [];

  const row = (a: Asset, main: React.ReactNode) => {
    const k = akey(a);
    const sel = selected[k];
    const on = !!sel;
    return (
      <div key={k} className="px-4 py-2.5">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={on} onChange={() => onToggle(a)} className="h-4 w-4" />
          <span className="flex-1">{main}</span>
        </label>
        {on && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-sm">
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

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {teamLabel} envia{isMine ? " (você)" : ""}
      </div>
      {!assets ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : all.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nada negociável.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {assets.players.map((p) =>
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
                  {p.salary ? fmtMoney(p.salary) : "—"}
                </span>
              </span>,
            ),
          )}
          {assets.picks.map((p) =>
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
            ),
          )}
          {assets.penalties.map((p) =>
            row(
              p,
              <span className="text-amber-700 dark:text-amber-400">
                {p.label} · saldo {fmtMoney(p.saldo)}
              </span>,
            ),
          )}
        </div>
      )}
    </div>
  );
}
