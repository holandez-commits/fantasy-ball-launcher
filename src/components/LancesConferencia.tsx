import { useEffect, useMemo, useState } from "react";
import { callRpc, fmtDateTime, fmtMoney } from "@/lib/market";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SemanaRow = { week_number: number; n_lances: number; n_vencedores: number };
type LanceRow = {
  bid_id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  team_name: string;
  salary_offer: number;
  status: string;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  won: "Vencedor",
  lost: "Não venceu",
  withdrawn: "Retirado",
  invalid: "Inválido",
};

/**
 * Conferência do leilão (admin): só semanas já consolidadas. Mostra todos os lances enviados,
 * agrupados por jogador (maior lance primeiro), com os vencedores destacados.
 * O banco recusa semana com lance ativo, então nada aqui revela lances antes da consolidação.
 */
export function LancesConferencia({ seasonId }: { seasonId: string }) {
  const [semanas, setSemanas] = useState<SemanaRow[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [lances, setLances] = useState<LanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [soVencedores, setSoVencedores] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await callRpc("get_lances_semanas", { _season_id: seasonId });
      if (!alive) return;
      if (error) {
        setErro(error.message);
        setSemanas([]);
        return;
      }
      const rows = ((data ?? []) as SemanaRow[]).map((r) => ({
        week_number: Number(r.week_number),
        n_lances: Number(r.n_lances),
        n_vencedores: Number(r.n_vencedores),
      }));
      setSemanas(rows);
      setWeek((cur) => cur ?? rows[0]?.week_number ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [seasonId]);

  useEffect(() => {
    if (week == null) {
      setLances(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErro(null);
    void (async () => {
      const { data, error } = await callRpc("get_lances_semana", { _season_id: seasonId, _week: week });
      if (!alive) return;
      setLoading(false);
      if (error) {
        setErro(error.message);
        setLances([]);
        return;
      }
      setLances(
        ((data ?? []) as LanceRow[]).map((r) => ({ ...r, salary_offer: Number(r.salary_offer) })),
      );
    })();
    return () => {
      alive = false;
    };
  }, [seasonId, week]);

  const visiveis = useMemo(
    () => (lances ?? []).filter((l) => !soVencedores || l.status === "won"),
    [lances, soVencedores],
  );
  const nVenc = (lances ?? []).filter((l) => l.status === "won").length;

  return (
    <section className="mt-12">
      <h2 className="mb-2 font-display text-xl tracking-tight">Conferência dos lances</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Todos os lances enviados em cada leilão já consolidado, com os vencedores em destaque. Semanas em
        andamento não aparecem aqui.
      </p>

      {semanas == null ? (
        <Skeleton className="h-16 w-full" />
      ) : semanas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum leilão consolidado ainda.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Semana</span>
              <select
                value={week ?? ""}
                onChange={(e) => setWeek(Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {semanas.map((s) => (
                  <option key={s.week_number} value={s.week_number}>
                    Semana {s.week_number} — {s.n_lances} lance(s), {s.n_vencedores} vencedor(es)
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={soVencedores}
                onChange={(e) => setSoVencedores(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Só vencedores</span>
            </label>
          </div>

          {erro && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{erro}</p>}

          {loading ? (
            <Skeleton className="mt-3 h-32 w-full" />
          ) : lances && lances.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Jogador</th>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-right">Lance</th>
                    <th className="px-3 py-2 text-left">Enviado em</th>
                    <th className="px-3 py-2 text-left">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l, i) => {
                    const venceu = l.status === "won";
                    const novoJogador = i === 0 || visiveis[i - 1].player_id !== l.player_id;
                    return (
                      <tr
                        key={l.bid_id}
                        className={cn(
                          venceu
                            ? "bg-emerald-500/10 font-medium"
                            : l.status === "lost"
                              ? ""
                              : "text-muted-foreground",
                          novoJogador && i > 0 && "border-t-2 border-border",
                        )}
                      >
                        <td className="px-3 py-1.5">{novoJogador ? l.player_name : ""}</td>
                        <td className="px-3 py-1.5">{l.team_name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(l.salary_offer)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtDateTime(l.created_at)}</td>
                        <td className="px-3 py-1.5">
                          {venceu ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              ✓ Vencedor
                            </span>
                          ) : (
                            (STATUS_LABEL[l.status] ?? l.status)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !erro && <p className="mt-3 text-sm text-muted-foreground">Sem lances nesta semana.</p>
          )}

          {lances && lances.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {lances.length} lance(s), {nVenc} vencedor(es). Por jogador: maior lance primeiro; empate no valor
              vale o lance enviado antes. "Não venceu" inclui lance maior que não coube no cap ou nas vagas do time.
            </p>
          )}
        </>
      )}
    </section>
  );
}
