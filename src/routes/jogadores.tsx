import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { callRpc } from "@/lib/market";
import { espnPlayerUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import { contractFromYears, fmtContract } from "@/lib/contracts";

export const Route = createFileRoute("/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Busque um jogador e veja em que time ele está." },
    ],
  }),
  component: JogadoresPage,
});

type Resultado = {
  player_id: string;
  full_name: string;
  espn_id: string | null;
  nba_team: string | null;
  team_id: string | null;
  team_name: string | null;
  team_slug: string | null;
  status: string | null;
  ir_type: string | null;
  position: string | null;
  contract: { season_label: string; salary: number }[];
};

function JogadoresPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Resultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const termo = q.trim();
  const curto = termo.length < 2;

  useEffect(() => {
    if (curto) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const { data, error: err } = await callRpc("buscar_jogadores", { _q: termo, _limit: 30 });
      if (mine !== seq.current) return; // chegou resposta de uma busca antiga
      setLoading(false);
      if (err) {
        setError(err.message);
        setItems([]);
        return;
      }
      setError(null);
      setItems((data ?? []) as Resultado[]);
    }, 250);
    return () => window.clearTimeout(t);
  }, [termo, curto]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="font-display text-2xl font-medium">Jogadores</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Digite o nome (sem precisar de acento) para ver em que time o jogador está.
      </p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ex.: doncic, schroder, jalen"
          className="pl-9"
          aria-label="Buscar jogador"
        />
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {curto ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Digite pelo menos 2 letras.
        </p>
      ) : loading && items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Buscando…</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum jogador encontrado para “{termo}”.
        </p>
      ) : (
        <ul className={cn("divide-y rounded-lg border", loading && "opacity-60")}>
          {items.map((p) => (
            <li key={p.player_id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {p.espn_id ? (
                    <a
                      href={espnPlayerUrl(p.espn_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ver na ESPN"
                      className="font-medium hover:underline"
                    >
                      {p.full_name}
                    </a>
                  ) : (
                    <span className="font-medium">{p.full_name}</span>
                  )}
                  {p.position && <span className="text-xs text-muted-foreground">{p.position}</span>}
                </div>
                {p.contract.length > 0 && (
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {fmtContract(contractFromYears(p.contract))}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-sm sm:text-right">
                {p.team_slug && p.team_name ? (
                  <Link
                    to="/times/$slug"
                    params={{ slug: p.team_slug }}
                    className="font-medium hover:text-[color:var(--court)] hover:underline"
                  >
                    {p.team_name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Free agent</span>
                )}
                {p.status === "injured_reserve" && (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                    {p.ir_type === "out_of_season" ? "IR fora da temporada" : "IR parcial"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
