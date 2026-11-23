import { useEffect, useState } from "react";
import { db, callRpc, fmtDateTime } from "@/lib/market";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

type Dif = { pos: string; slot: string; por_jogo: { jogo: number; jogador: string }[] };
type Linha = {
  team_id: string;
  team_name: string;
  jogos: number[];
  diferencas: Dif[];
  locks_at: string;
};

/**
 * Aviso (admin): depois do prazo da escalação de uma semana, mostra os times que escalaram
 * diferente entre jogos da mesma semana. Confere a última semana cujo prazo já passou; dá para
 * trocar de semana. O banco só devolve linhas depois do prazo (roster_locks.locks_at).
 */
export function EscalacoesDivergentes({ seasonId }: { seasonId: string }) {
  const [semanas, setSemanas] = useState<number[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data, error } = await db
          .from("roster_locks")
          .select("week_number, locks_at")
          .eq("season_id", seasonId)
          .lte("locks_at", new Date().toISOString())
          .order("week_number", { ascending: false });
        if (error) throw new Error(error.message);
        if (!alive) return;
        const ws = ((data ?? []) as { week_number: number }[]).map((r) => r.week_number);
        setSemanas(ws);
        setWeek(ws[0] ?? null);
      } catch (e) {
        if (alive) setErro(e instanceof Error ? e.message : "Erro ao carregar semanas.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [seasonId]);

  useEffect(() => {
    if (week == null) return;
    let alive = true;
    setLinhas(null);
    setErro(null);
    void (async () => {
      const { data, error } = await callRpc("get_escalacoes_divergentes", {
        _season_id: seasonId,
        _week: week,
      });
      if (!alive) return;
      if (error) {
        setErro(error.message);
        return;
      }
      setLinhas((data ?? []) as Linha[]);
    })();
    return () => {
      alive = false;
    };
  }, [seasonId, week]);

  if (semanas == null && !erro) return <Skeleton className="mt-8 h-16 w-full" />;
  if (semanas != null && semanas.length === 0) return null;

  const temDiv = (linhas?.length ?? 0) > 0;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl tracking-tight">
          Escalações diferentes na mesma semana{temDiv ? ` (${linhas?.length})` : ""}
        </h2>
        {semanas && semanas.length > 1 && (
          <select
            aria-label="Semana"
            value={week ?? ""}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          >
            {semanas.map((w) => (
              <option key={w} value={w}>
                Semana {w}
              </option>
            ))}
          </select>
        )}
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {!erro && linhas == null && <Skeleton className="h-16 w-full" />}

      {!erro && linhas != null && !temDiv && (
        <p className="text-sm text-muted-foreground">
          Semana {week}: nenhum time escalou diferente entre jogos.
        </p>
      )}

      {!erro && temDiv && (
        <>
          <Alert className="mb-3">
            <AlertTitle>
              Semana {week}: {linhas!.length} {linhas!.length === 1 ? "time escalou" : "times escalaram"}{" "}
              diferente entre jogos
            </AlertTitle>
            <AlertDescription className="text-xs">
              Prazo encerrado em {fmtDateTime(linhas![0].locks_at)}. Só aparecem as posições em que
              o jogador muda de um jogo para outro.
            </AlertDescription>
          </Alert>
          <div className="space-y-3">
            {linhas!.map((l) => (
              <div key={l.team_id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{l.team_name}</span>
                  <span className="text-xs text-muted-foreground">
                    Jogos comparados: {l.jogos.map((j) => `J${String(j).padStart(2, "0")}`).join(", ")}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1 pr-3 font-normal">Posição</th>
                        {l.jogos.map((j) => (
                          <th key={j} className="py-1 pr-3 font-normal">
                            J{String(j).padStart(2, "0")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {l.diferencas.map((d) => (
                        <tr key={`${d.pos}-${d.slot}`} className="border-t border-border">
                          <td className="py-1 pr-3 whitespace-nowrap">
                            {d.pos} · {d.slot === "titular" ? "titular" : "reserva"}
                          </td>
                          {l.jogos.map((j) => (
                            <td key={j} className="py-1 pr-3">
                              {d.por_jogo.find((p) => p.jogo === j)?.jogador ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
