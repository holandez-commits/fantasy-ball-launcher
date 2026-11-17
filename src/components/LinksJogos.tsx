import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { callRpc } from "@/lib/finalizar";
import {
  casarAbas,
  keyOf,
  lerAbasFn,
  type JogoParaLink,
  type LinhaLink,
} from "@/lib/planilha-links";

type Props = {
  weekLabel: string;
  games: JogoParaLink[];
  teamNames: Map<string, string>;
  onSaved: () => void;
};

type Preview = { code: string; linhas: LinhaLink[]; abasSemJogo: string[]; erro?: string };

const STATUS_TXT: Record<LinhaLink["status"], { txt: string; cls: string }> = {
  novo: { txt: "novo link", cls: "text-emerald-700 dark:text-emerald-400" },
  igual: { txt: "já está igual", cls: "text-muted-foreground" },
  diferente: { txt: "já tem outro link", cls: "text-amber-700 dark:text-amber-400" },
  sem_aba: { txt: "aba não encontrada", cls: "text-destructive" },
  ambigua: { txt: "mais de uma aba", cls: "text-destructive" },
};

export function LinksJogos({ weekLabel, games, teamNames, onSaved }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rodadas = useMemo(() => {
    const m = new Map<string, JogoParaLink[]>();
    for (const g of games) {
      const code = g.game_code ?? "—";
      if (!m.has(code)) m.set(code, []);
      m.get(code)!.push(g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [games]);

  const comLink = games.filter((g) => g.external_url).length;

  async function ler() {
    setReading(true);
    setMsg(null);
    setPreviews(null);
    try {
      const { data: ts } = await supabase.from("teams").select("id, name, sheet_nickname");
      const teamKeys = new Map<string, Set<string>>();
      for (const t of (ts ?? []) as unknown as { id: string; name: string; sheet_nickname: string | null }[]) {
        const s = new Set<string>();
        if (t.sheet_nickname) s.add(keyOf(t.sheet_nickname));
        s.add(keyOf(t.name));
        if (s.has("lightcity")) s.add("lighthalzen"); // nome antigo, ainda usado em algumas abas
        teamKeys.set(t.id, s);
      }
      const out: Preview[] = [];
      for (const [code, gs] of rodadas) {
        const url = (urls[code] ?? "").trim();
        if (!url) continue;
        const r = await lerAbasFn({ data: url });
        if (!r.ok) {
          out.push({ code, linhas: [], abasSemJogo: [], erro: r.message });
          continue;
        }
        const { linhas, abasSemJogo } = casarAbas(r.docId, r.abas, gs, teamKeys);
        out.push({ code, linhas, abasSemJogo });
      }
      if (out.length === 0) setMsg({ ok: false, text: "Cole pelo menos um link de planilha." });
      else setPreviews(out);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro ao ler as planilhas." });
    } finally {
      setReading(false);
    }
  }

  const gravaveis = useMemo(
    () =>
      (previews ?? [])
        .flatMap((p) => p.linhas)
        .filter((l) => l.url && (l.status === "novo" || (overwrite && l.status === "diferente"))),
    [previews, overwrite],
  );

  async function gravar() {
    setSaving(true);
    setMsg(null);
    const { data, error } = await callRpc("definir_links_jogos", {
      _items: gravaveis.map((l) => ({ game_id: l.game.id, url: l.url })),
      _overwrite: overwrite,
    });
    setSaving(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setMsg({ ok: true, text: typeof data === "string" ? data : "Links gravados." });
    setPreviews(null);
    setUrls({});
    onSaved();
  }

  const nome = (id: string) => teamNames.get(id) ?? "—";

  return (
    <details className="mt-6 rounded-lg border border-border bg-card" open={comLink < games.length}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
        Links das planilhas — {weekLabel}{" "}
        <span className="font-normal text-muted-foreground">
          ({comLink}/{games.length} jogos com link)
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <p className="text-xs text-muted-foreground">
          Cole o link da planilha de cada rodada (a planilha precisa estar como “qualquer pessoa com o
          link pode ver”). O site lê as abas, casa cada aba “Time A x Time B” com o confronto e mostra a
          prévia antes de gravar.
        </p>
        {rodadas.map(([code, gs]) => (
          <div key={code} className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-center">
            <label htmlFor={`url-${code}`} className="text-sm font-medium">
              {code}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({gs.filter((g) => g.external_url).length}/{gs.length})
              </span>
            </label>
            <input
              id={`url-${code}`}
              type="url"
              value={urls[code] ?? ""}
              onChange={(e) => setUrls((u) => ({ ...u, [code]: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void ler()} disabled={reading || saving}>
            {reading ? "Lendo planilhas…" : "Ler planilhas"}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Substituir links que já existem
          </label>
        </div>

        {msg && (
          <Alert variant={msg.ok ? "default" : "destructive"}>
            <AlertTitle>{msg.ok ? "Pronto" : "Atenção"}</AlertTitle>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        )}

        {previews && (
          <div className="space-y-4">
            {previews.map((p) => (
              <div key={p.code}>
                <h3 className="mb-1 text-sm font-semibold">{p.code}</h3>
                {p.erro ? (
                  <p className="text-sm text-destructive">{p.erro}</p>
                ) : (
                  <>
                    <ul className="divide-y divide-border rounded-md border border-border text-sm">
                      {p.linhas.map((l) => (
                        <li key={l.game.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span>
                            {nome(l.game.home_team_id)} × {nome(l.game.away_team_id)}
                          </span>
                          <span className="text-xs">
                            {l.aba && <span className="mr-2 text-muted-foreground">aba “{l.aba.name}”</span>}
                            <span className={STATUS_TXT[l.status].cls}>{STATUS_TXT[l.status].txt}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {p.abasSemJogo.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Abas sem jogo nesta rodada: {p.abasSemJogo.join(", ")}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
            <Button size="sm" onClick={() => void gravar()} disabled={saving || gravaveis.length === 0}>
              {saving ? "Gravando…" : `Gravar ${gravaveis.length} link(s)`}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
