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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leilao")({
  head: () => ({
    meta: [
      { title: "Leilão de free agents — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeilaoPage,
});

type FA = { playerId: string; name: string };
type MyBid = { bidId: string; salaryOffer: number; status: string };

const MIN_BID = 750_000;

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-12 md:px-6">{children}</div>;
}

function LeilaoPage() {
  const { ready, forbidden, teamId } = useRequireAuth({ role: "gm" });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [capAvail, setCapAvail] = useState<number | null>(null);
  const [fas, setFas] = useState<FA[]>([]);
  const [myBids, setMyBids] = useState<Record<string, MyBid>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
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

      // semana do leilão = semana travada mais recente (maior week_number em roster_locks)
      const wkRes = await db
        .from("roster_locks")
        .select("week_number")
        .eq("season_id", cur.id)
        .order("week_number", { ascending: false })
        .limit(1);
      const wk = (wkRes.data as { week_number: number }[] | null)?.[0]?.week_number ?? null;
      setWeek(wk);
      if (wk == null) {
        setLoading(false);
        return; // sem semana travada -> nada a leiloar
      }

      // cap disponível do meu time
      const capRes = await callRpc("team_cap_usage", { _season_id: cur.id });
      const capRows = (capRes.data ?? []) as { team_id: string; available: number }[];
      setCapAvail(capRows.find((c) => c.team_id === teamId)?.available ?? null);

      // pool de FA = players fora de qualquer elenco da temporada (elenco ao vivo)
      const rosterRes = await db.from("roster_entries").select("player_id").eq("season", cur.start_year);
      const inRoster = new Set(
        ((rosterRes.data ?? []) as { player_id: string }[]).map((r) => r.player_id),
      );
      const plRes = await db.from("players").select("id, full_name").order("full_name");
      const pool = ((plRes.data ?? []) as { id: string; full_name: string }[])
        .filter((p) => !inRoster.has(p.id))
        .map((p) => ({ playerId: p.id, name: p.full_name }));
      setFas(pool);

      // meus lances da semana
      const bidRes = await db
        .from("free_agent_bids")
        .select("id, player_id, salary_offer, status")
        .eq("season_id", cur.id)
        .eq("week_number", wk)
        .eq("team_id", teamId);
      const mine: Record<string, MyBid> = {};
      for (const b of (bidRes.data ?? []) as {
        id: string;
        player_id: string;
        salary_offer: number;
        status: string;
      }[]) {
        mine[b.player_id] = { bidId: b.id, salaryOffer: b.salary_offer, status: b.status };
      }
      setMyBids(mine);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar o leilão.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (ready && teamId) void load();
  }, [ready, teamId, load]);

  async function darLance(playerId: string) {
    if (week == null) return;
    const raw = inputs[playerId] ?? "";
    const val = Math.round(Number(raw));
    if (!val || Number.isNaN(val)) {
      setResult({ ok: false, message: "Informe um valor de lance." });
      return;
    }
    setBusy(playerId);
    setResult(null);
    const { error } = await callRpc("dar_lance", {
      _player_id: playerId,
      _salary_offer: val,
      _week: week,
    });
    setBusy(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: "Lance registrado." });
      void load();
    }
  }

  async function retirar(bidId: string, playerId: string) {
    setBusy(playerId);
    setResult(null);
    const { data, error } = await callRpc("retirar_lance", { _bid_id: bidId });
    setBusy(null);
    if (error) setResult({ ok: false, message: error.message });
    else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Lance retirado." });
      void load();
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? fas.filter((f) => f.name.toLowerCase().includes(q)) : fas;
    return list.slice(0, 60);
  }, [fas, search]);

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
        <h1 className="font-display text-3xl">Leilão</h1>
        <Alert className="mt-6">
          <AlertDescription>Sua conta não tem time associado.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <Link to="/mercado" className="text-sm text-muted-foreground hover:text-foreground">
          ← Mercado
        </Link>
      </div>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Temporada {season?.label ?? ""}
        {week != null ? ` · semana ${week}` : ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Leilão de free agents</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Lance = salário oferecido (mín {fmtMoney(MIN_BID)}). O maior salário leva; empate, quem
        lançou antes. Lance <strong>não garante</strong> contratação: o cap e as vagas são
        resolvidos na consolidação de domingo.
      </p>

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
        <Skeleton className="mt-8 h-96 w-full" />
      ) : marketOpen ? (
        <Alert className="mt-8">
          <AlertTitle>Leilão fechado</AlertTitle>
          <AlertDescription>
            Os lances de free agent só são permitidos com o mercado <strong>fechado</strong>. Agora
            ele está aberto.
          </AlertDescription>
        </Alert>
      ) : week == null ? (
        <Alert className="mt-8">
          <AlertDescription>
            Nenhuma semana foi travada ainda — o leilão usa a semana travada mais recente.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            Seu cap disponível:{" "}
            <span className="font-semibold tabular-nums">
              {capAvail != null ? fmtMoney(capAvail) : "—"}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              (um lance isolado não pode passar disso)
            </span>
          </div>

          <div className="mt-6">
            <Input
              placeholder="Buscar free agent pelo nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {fas.length === 0 ? "Nenhum free agent disponível." : "Nenhum resultado."}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {filtered.map((f) => {
                  const bid = myBids[f.playerId];
                  const busyRow = busy === f.playerId;
                  return (
                    <li
                      key={f.playerId}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className="min-w-[160px] flex-1 font-medium">{f.name}</span>
                      {bid && (
                        <span
                          className={cn(
                            "text-xs",
                            bid.status === "active"
                              ? "text-sky-600 dark:text-sky-400"
                              : "text-muted-foreground",
                          )}
                        >
                          seu lance: {fmtMoney(bid.salaryOffer)}
                          {bid.status !== "active" ? ` (${bid.status})` : ""}
                        </span>
                      )}
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN_BID}
                        step={50000}
                        placeholder={String(MIN_BID)}
                        value={inputs[f.playerId] ?? ""}
                        onChange={(e) =>
                          setInputs((cur) => ({ ...cur, [f.playerId]: e.target.value }))
                        }
                        className="w-32"
                      />
                      <Button
                        size="sm"
                        onClick={() => void darLance(f.playerId)}
                        disabled={busyRow}
                      >
                        {busyRow ? "..." : bid && bid.status === "active" ? "Atualizar" : "Dar lance"}
                      </Button>
                      {bid && bid.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void retirar(bid.bidId, f.playerId)}
                          disabled={busyRow}
                        >
                          Retirar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {fas.length > filtered.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando {filtered.length} de {fas.length}. Use a busca pra filtrar.
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
