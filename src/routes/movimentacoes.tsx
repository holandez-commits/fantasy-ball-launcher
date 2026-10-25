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
const PAGE_SIZE = 30;

type Filtros = { months: string[]; teams: { id: string; name: string }[] };

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

/** "2026-10" -> "Outubro de 2026". */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const selectClass =
  "h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[color:var(--court)]/40";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">{children}</div>;
}

function MovimentacoesPage() {
  const [ready, setReady] = useState(false); // temporada resolvida + filtros carregados
  const [loading, setLoading] = useState(true); // carregando a lista (1ª carga ou troca de filtro)
  const [loadingMore, setLoadingMore] = useState(false);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [total, setTotal] = useState(0);
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({ months: [], teams: [] });
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const seasonId = useRef<string | null>(null);
  // Invalida respostas antigas quando o filtro muda no meio de uma requisição.
  const reqId = useRef(0);

  const hasFilter = monthFilter !== "all" || teamFilter !== "all";

  const fetchPage = useCallback(
    async (month: string, team: string, offset: number, limit: number) => {
      const { data, error } = await callRpc("get_movimentacoes_pagina", {
        _season_id: seasonId.current,
        _month: month === "all" ? null : month,
        _team_id: team === "all" ? null : team,
        _limit: limit,
        _offset: offset,
      });
      if (error || !Array.isArray(data)) return null;
      const rows = data as (Mov & { total_count: number | string })[];
      return { rows: rows as Mov[], total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
    },
    [],
  );

  const fetchFiltros = useCallback(async () => {
    const { data, error } = await callRpc("get_movimentacoes_filtros", {
      _season_id: seasonId.current,
    });
    if (!error && data && typeof data === "object") {
      const f = data as Partial<Filtros>;
      setFiltros({ months: f.months ?? [], teams: f.teams ?? [] });
    }
  }, []);

  // Temporada atual + opções dos filtros.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cur = await fetchCurrentSeason();
      if (cancelled) return;
      setSeason(cur);
      seasonId.current = cur?.id ?? null;
      await fetchFiltros();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchFiltros]);

  // Primeira página: na carga inicial e a cada mudança de filtro.
  useEffect(() => {
    if (!ready) return;
    const my = ++reqId.current;
    setLoading(true);
    void (async () => {
      const res = await fetchPage(monthFilter, teamFilter, 0, PAGE_SIZE);
      if (my !== reqId.current) return;
      if (res) {
        setMovs(res.rows);
        setTotal(res.total);
      }
      setLoading(false);
    })();
  }, [ready, monthFilter, teamFilter, fetchPage]);

  // Atualização automática: re-busca só a primeira página e preserva o que já foi
  // carregado além dela (sem duplicar), então "Carregar mais" não se perde.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const my = reqId.current;
      void (async () => {
        const [res] = await Promise.all([
          fetchPage(monthFilter, teamFilter, 0, PAGE_SIZE),
          fetchFiltros(),
        ]);
        if (!res || my !== reqId.current) return;
        setMovs((old) => {
          const fresh = new Set(res.rows.map((m) => m.id));
          return [...res.rows, ...old.filter((m) => !fresh.has(m.id))];
        });
        setTotal(res.total);
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [ready, monthFilter, teamFilter, fetchPage, fetchFiltros]);

  async function loadMore() {
    if (loadingMore) return;
    const my = reqId.current;
    setLoadingMore(true);
    const res = await fetchPage(monthFilter, teamFilter, movs.length, PAGE_SIZE);
    if (res && my === reqId.current) {
      setMovs((old) => {
        const have = new Set(old.map((m) => m.id));
        return [...old, ...res.rows.filter((m) => !have.has(m.id))];
      });
      setTotal(res.total);
    }
    setLoadingMore(false);
  }

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Temporada {season?.label ?? ""}
      </p>
      <h1 className="mt-1 font-display text-3xl">Movimentações</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dispensas, trocas, contratações e IR já processados pelo admin. Atualiza automaticamente.
      </p>

      {ready && (filtros.months.length > 0 || filtros.teams.length > 0) && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <select
            aria-label="Filtrar por mês e ano"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">Todos os meses</option>
            {filtros.months.map((k) => (
              <option key={k} value={k}>
                {monthLabel(k)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por equipe"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">Todas as equipes</option>
            {filtros.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setMonthFilter("all");
                setTeamFilter("all");
              }}
              className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Limpar filtros
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {movs.length} de {total}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : movs.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          {hasFilter
            ? "Nenhuma movimentação para esse filtro."
            : "Nenhuma movimentação processada ainda."}
        </p>
      ) : (
        <div className="mt-6 space-y-3">
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

      {!loading && movs.length > 0 && movs.length < total && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="h-9 rounded-md border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {loadingMore ? "Carregando…" : `Carregar mais (${total - movs.length})`}
          </button>
        </div>
      )}
    </Shell>
  );
}
