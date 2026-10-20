import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  callRpc,
  fmtMoney,
  fmtDateTime,
  groupTradeByDirection,
  fetchCurrentSeason,
  TX_TYPE_LABEL,
  type CurrentSeason,
} from "@/lib/market";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações — Liga Bola Presa de Fantasy" },
      {
        name: "description",
        content: "Todas as movimentações da liga: dispensas, trocas, contratações e IR.",
      },
    ],
  }),
  component: MovimentacoesPage,
});

type MovItem = {
  asset_type: string;
  player: string | null;
  from: string | null;
  to: string | null;
  amount: number | null;
  pick: string | null;
};
type Mov = {
  id: string;
  type: string;
  status: string;
  processed_at: string | null;
  week_number: number | null;
  items: MovItem[];
};

const POLL_MS = 20_000;

function typeTone(type: string): string {
  switch (type) {
    case "trade":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
    case "signing":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "release":
      return "bg-red-500/15 text-red-600 dark:text-red-400";
    case "ir":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function assetLabel(it: MovItem): string {
  if (it.asset_type === "player") return it.player ?? "—";
  if (it.asset_type === "pick") return it.pick ? `Pick ${it.pick}` : "Pick";
  return `Multa ${fmtMoney(it.amount ?? 0)}`;
}

/** Linha-resumo pra movimentações de um time só (dispensa / IR / contratação). */
function singleTeamSummary(m: Mov): { team: string; verb: string; player: string; extra: string[] } {
  const p = m.items.find((i) => i.asset_type === "player");
  const verb =
    m.type === "release"
      ? "dispensou"
      : m.type === "ir"
        ? "moveu para o IR"
        : m.type === "signing"
          ? "contratou"
          : "movimentou";
  const team = (m.type === "signing" ? p?.to : p?.from) ?? p?.from ?? p?.to ?? "—";
  const extra = m.items
    .filter((i) => i.asset_type !== "player" && i.amount != null)
    .map((i) => `Multa ${fmtMoney(i.amount ?? 0)}`);
  return { team, verb, player: p?.player ?? "—", extra };
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

function MovimentacoesPage() {
  const [loading, setLoading] = useState(true);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const seasonId = useRef<string | null>(null);

  const fetchMovs = useCallback(async () => {
    const { data, error } = await callRpc("get_movimentacoes", {
      _season_id: seasonId.current,
      _limit: 200,
    });
    if (!error && Array.isArray(data)) setMovs(data as Mov[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cur = await fetchCurrentSeason();
      if (cancelled) return;
      setSeason(cur);
      seasonId.current = cur?.id ?? null;
      await fetchMovs();
      if (!cancelled) setLoading(false);
    })();
    const id = window.setInterval(() => void fetchMovs(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fetchMovs]);

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Temporada {season?.label ?? ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Movimentações</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dispensas, trocas, contratações e IR já processados pelo admin. Atualiza automaticamente.
      </p>

      {loading ? (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : movs.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          Nenhuma movimentação processada ainda.
        </p>
      ) : (
        <div className="mt-8 space-y-3">
          {movs.map((m) => (
            <div key={m.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      typeTone(m.type),
                    )}
                  >
                    {TX_TYPE_LABEL[m.type] ?? m.type}
                  </span>
                  {m.week_number != null && (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Semana {m.week_number}
                    </span>
                  )}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fmtDateTime(m.processed_at)}
                </span>
              </div>

              {m.type === "trade" ? (
                <div className="space-y-2 text-sm">
                  {groupTradeByDirection(
                    m.items.map((it) => ({
                      label: assetLabel(it),
                      fromName: it.from ?? "—",
                      toName: it.to ?? "—",
                    })),
                  ).map((g, gi) => (
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
              ) : (
                (() => {
                  const s = singleTeamSummary(m);
                  return (
                    <p className="text-sm">
                      <span className="font-semibold">{s.team}</span> {s.verb}{" "}
                      <span className="font-semibold">{s.player}</span>
                      {s.extra.length > 0 && (
                        <span className="text-muted-foreground"> · {s.extra.join(" · ")}</span>
                      )}
                    </p>
                  );
                })()
              )}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
