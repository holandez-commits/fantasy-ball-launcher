import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/trocar")({
  head: () => ({
    meta: [
      { title: "Propor troca — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrocarPage,
});

type TeamLite = { id: string; name: string };
type PlayerAsset = { playerId: string; name: string; position: string | null; salary: number };
type PickAsset = {
  pickId: string;
  round: number;
  label: string;
  viaTeam: string | null; // nome do time original, se veio por troca
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

// Default do prazo: +7 dias, formatado p/ datetime-local (horário local do browser).
function defaultDeadline(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadTeamAssets(teamId: string, season: CurrentSeason) {
  // Jogadores ativos
  const reRes = await db
    .from("roster_entries")
    .select("id, player_id, position, player:players(full_name)")
    .eq("team_id", teamId)
    .eq("season", season.start_year)
    .eq("status", "active");
  const entries = (reRes.data ?? []) as {
    id: string;
    player_id: string;
    position: string | null;
    player: { full_name: string } | null;
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
      playerId: e.player_id,
      name: e.player?.full_name ?? "—",
      position: e.position,
      salary: cy.find((c) => c.roster_entry_id === e.id && c.season_label === season.label)?.salary ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Picks negociáveis (não usadas, não em disputa)
  const pkRes = await db
    .from("draft_picks")
    .select(
      "id, round, pick_number, original_team_id, season:seasons!draft_picks_draft_season_id_fkey(label, start_year), original_team:teams!draft_picks_original_team_id_fkey(name)",
    )
    .eq("current_team_id", teamId)
    .eq("is_used", false)
    .eq("disputed", false);
  const picks: PickAsset[] = ((pkRes.data ?? []) as {
    id: string;
    round: number;
    original_team_id: string;
    season: { label: string; start_year: number } | null;
    original_team: { name: string } | null;
  }[])
    .map((p) => ({
      pickId: p.id,
      round: p.round,
      label: p.season?.label ?? "—",
      viaTeam: p.original_team_id !== teamId ? p.original_team?.name ?? null : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.round - b.round);

  return { players, picks };
}

function TrocarPage() {
  const { ready, forbidden, teamId } = useRequireAuth({ role: "gm" });
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [otherTeams, setOtherTeams] = useState<TeamLite[]>([]);
  const [myAssets, setMyAssets] = useState<{ players: PlayerAsset[]; picks: PickAsset[] }>({
    players: [],
    picks: [],
  });

  const [otherId, setOtherId] = useState<string>("");
  const [otherAssets, setOtherAssets] = useState<{ players: PlayerAsset[]; picks: PickAsset[] }>({
    players: [],
    picks: [],
  });
  const [otherLoading, setOtherLoading] = useState(false);

  // seleção: conjuntos de ids
  const [sendPlayers, setSendPlayers] = useState<Set<string>>(new Set());
  const [sendPicks, setSendPicks] = useState<Set<string>>(new Set());
  const [recvPlayers, setRecvPlayers] = useState<Set<string>>(new Set());
  const [recvPicks, setRecvPicks] = useState<Set<string>>(new Set());
  const [deadline, setDeadline] = useState<string>(defaultDeadline());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
      setOtherTeams(
        ((teamsRes.data ?? []) as TeamLite[] & { is_active: boolean }[]).filter(
          (t) => t.id !== teamId,
        ),
      );

      setMyAssets(await loadTeamAssets(teamId, cur));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (ready && teamId) void load();
  }, [ready, teamId, load]);

  // carrega os ativos do outro time quando selecionado
  useEffect(() => {
    if (!otherId || !season) return;
    let cancelled = false;
    setOtherLoading(true);
    setRecvPlayers(new Set());
    setRecvPicks(new Set());
    (async () => {
      const a = await loadTeamAssets(otherId, season);
      if (!cancelled) {
        setOtherAssets(a);
        setOtherLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otherId, season]);

  const totalItems =
    sendPlayers.size + sendPicks.size + recvPlayers.size + recvPicks.size;

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
    setResult(null);
  }

  const otherName = useMemo(
    () => otherTeams.find((t) => t.id === otherId)?.name ?? "o outro time",
    [otherTeams, otherId],
  );

  async function propor() {
    if (!teamId || !otherId) return;
    const itens: Record<string, unknown>[] = [];
    for (const pid of sendPlayers)
      itens.push({ asset_type: "player", player_id: pid, from_team_id: teamId, to_team_id: otherId });
    for (const kid of sendPicks)
      itens.push({ asset_type: "pick", pick_id: kid, from_team_id: teamId, to_team_id: otherId });
    for (const pid of recvPlayers)
      itens.push({ asset_type: "player", player_id: pid, from_team_id: otherId, to_team_id: teamId });
    for (const kid of recvPicks)
      itens.push({ asset_type: "pick", pick_id: kid, from_team_id: otherId, to_team_id: teamId });

    if (itens.length === 0) {
      setResult({ ok: false, message: "Selecione ao menos um ativo pra trocar." });
      return;
    }

    // datetime-local -> ISO com offset local
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
      setResult({ ok: true, message: "Troca proposta! Aguardando o aceite do outro time." });
      // limpa a seleção
      setSendPlayers(new Set());
      setSendPicks(new Set());
      setRecvPlayers(new Set());
      setRecvPicks(new Set());
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

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/mercado" className="text-sm text-muted-foreground hover:text-foreground">
          ← Mercado
        </Link>
      </div>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Temporada {season?.label ?? ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Propor troca</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Troca entre dois times, com jogadores e picks. O outro time aceita, depois o admin aprova e
        executa. O cap e as vagas são checados já na proposta.
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
          {/* Seleciona o outro time */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Label htmlFor="other" className="text-sm">
              Trocar com
            </Label>
            <Select value={otherId} onValueChange={setOtherId}>
              <SelectTrigger id="other" className="w-64">
                <SelectValue placeholder="Selecione o time" />
              </SelectTrigger>
              <SelectContent>
                {otherTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {otherId && (
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <AssetColumn
                title="Você envia"
                loading={false}
                players={myAssets.players}
                picks={myAssets.picks}
                selPlayers={sendPlayers}
                selPicks={sendPicks}
                onTogglePlayer={(id) => toggle(sendPlayers, setSendPlayers, id)}
                onTogglePick={(id) => toggle(sendPicks, setSendPicks, id)}
              />
              <AssetColumn
                title={`Você recebe de ${otherName}`}
                loading={otherLoading}
                players={otherAssets.players}
                picks={otherAssets.picks}
                selPlayers={recvPlayers}
                selPicks={recvPicks}
                onTogglePlayer={(id) => toggle(recvPlayers, setRecvPlayers, id)}
                onTogglePick={(id) => toggle(recvPicks, setRecvPicks, id)}
              />
            </div>
          )}

          {otherId && (
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
              <Button onClick={() => void propor()} disabled={submitting || totalItems === 0}>
                {submitting ? "Enviando..." : `Propor troca (${totalItems})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

function AssetColumn({
  title,
  loading,
  players,
  picks,
  selPlayers,
  selPicks,
  onTogglePlayer,
  onTogglePick,
}: {
  title: string;
  loading: boolean;
  players: PlayerAsset[];
  picks: PickAsset[];
  selPlayers: Set<string>;
  selPicks: Set<string>;
  onTogglePlayer: (id: string) => void;
  onTogglePick: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {loading ? (
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {players.length === 0 && picks.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nada negociável.</p>
          )}
          {players.map((p) => {
            const on = selPlayers.has(p.playerId);
            return (
              <label
                key={p.playerId}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40",
                  on && "bg-[color:var(--court)]/10",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onTogglePlayer(p.playerId)}
                  className="h-4 w-4"
                />
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.position ?? "—"}</span>
                <span className="w-20 text-right tabular-nums text-muted-foreground">
                  {p.salary ? fmtMoney(p.salary) : "—"}
                </span>
              </label>
            );
          })}
          {picks.map((k) => {
            const on = selPicks.has(k.pickId);
            return (
              <label
                key={k.pickId}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40",
                  on && "bg-[color:var(--court)]/10",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onTogglePick(k.pickId)}
                  className="h-4 w-4"
                />
                <span className="flex-1">
                  Pick {k.round}ª rod. · {k.label}
                  {k.viaTeam && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      via {k.viaTeam}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
