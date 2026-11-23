import type { BuscaPosicaoResult } from "@/lib/bbref-posicao";
import { POS_ORDEM } from "@/lib/bbref-posicao-core";

export type EstadoBR = BuscaPosicaoResult | "buscando";

/** Resultado da busca no Basketball Reference: sugestão, números das temporadas usadas e opções para escolher. */
export function SugestaoPosicaoBR({
  res,
  atual,
  onPick,
}: {
  res: EstadoBR | undefined;
  atual: string;
  onPick: (pos: string) => void;
}) {
  if (!res) return null;
  if (res === "buscando") {
    return <p className="mt-2 text-xs text-muted-foreground">Buscando no Basketball Reference…</p>;
  }
  if (!res.ok) {
    return (
      <div className="mt-2 text-xs text-red-600 dark:text-red-400">
        {res.message}
        {res.candidatos && (
          <ul className="mt-1 list-disc pl-4">
            {res.candidatos.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {c.nome}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const s = res.sugestao;
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          Basketball Reference{res.nomeBR ? ` (${res.nomeBR})` : ""}:
        </span>
        {s.status === "clara" ? (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
            {s.sugestao}
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            {s.status === "sem_dados" ? "sem dados suficientes" : "sem consenso"} — escolha:
          </span>
        )}
        {s.status !== "clara" &&
          s.opcoes.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onPick(o)}
              className={
                "rounded border px-1.5 py-0.5 font-semibold " +
                (atual === o ? "border-emerald-600 bg-emerald-500/20" : "border-border bg-background hover:bg-muted")
              }
            >
              {o}
            </button>
          ))}
        <a
          href={res.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-muted-foreground underline"
        >
          ver no site
        </a>
      </div>
      {s.temporadas.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 tabular-nums text-muted-foreground">
          {s.temporadas.map((t) => (
            <li key={t.season}>
              {t.season} {t.team} · {t.g} J · {String(t.mpg).replace(".", ",")} min:{" "}
              {POS_ORDEM.map((p, i) => (
                <span key={p} className={t.pct[i] >= s.limite ? "font-semibold text-foreground" : ""}>
                  {p} {t.pct[i]}%{i < 4 ? " · " : ""}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-muted-foreground">{s.regra}</p>
    </div>
  );
}
