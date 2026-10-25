import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PrepareResult, LivePlacar } from "@/lib/confronto-server";
import { prepararFn, restantesFn, callRpc } from "@/lib/finalizar";

export const Route = createFileRoute("/admin/resultados")({
  head: () => ({
    meta: [
      { title: "Resultados — Admin — Liga Bola Presa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResultadosPage,
});

type SeasonOpt = { id: string; label: string; start_year: number; is_current: boolean };
type WeekEntry = { season_id: string; week_number: number };
type Team = { id: string; name: string };
type GameRow = {
  id: string;
  game_code: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  external_url: string | null;
};

type RowOutcome =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; msg: string }
  | { kind: "pending_confirm"; prep: Extract<PrepareResult, { ok: true }> }
  | { kind: "unmatched"; names: string[] }
  | { kind: "error"; msg: string };

type PreviewItem = {
  game: GameRow;
  prep: PrepareResult | null;
  status: "ok" | "pending" | "unmatched" | "parse" | "sem_planilha" | "erro";
  detail: string;
};

function classifyPrep(prep: PrepareResult): { status: PreviewItem["status"]; detail: string } {
  if (!prep.ok) {
    if (prep.reason === "sem_planilha") return { status: "sem_planilha", detail: "sem planilha vinculada" };
    if (prep.reason === "nao_encontrado") return { status: "erro", detail: "jogo não encontrado" };
    return { status: "parse", detail: prep.message ?? "erro de leitura" };
  }
  if (prep.build.unmatched.length) {
    return { status: "unmatched", detail: prep.build.unmatched.map((u) => u.name).join(", ") };
  }
  const placar = `${prep.homeScore}–${prep.awayScore}`;
  if (prep.anyPending) return { status: "pending", detail: `${placar} · ainda há jogadores sem stats` };
  return { status: "ok", detail: placar };
}

// Quantos jogadores ainda faltam jogar no confronto (mandante × visitante).
function RestantesTag({ live, loading }: { live: LivePlacar | undefined; loading: boolean }) {
  if (!live) {
    return loading ? <span className="text-xs text-muted-foreground">lendo…</span> : null;
  }
  if (!live.ok) {
    return (
      <span title="Não consegui ler a planilha deste confronto" className="text-xs text-destructive">
        erro de leitura
      </span>
    );
  }
  const h = live.homePending ?? 0;
  const a = live.awayPending ?? 0;
  if (h + a === 0) {
    return <span className="text-xs font-semibold text-[color:var(--court)]">✓ completo</span>;
  }
  return (
    <span
      title={`Faltam jogar: ${h} do mandante e ${a} do visitante`}
      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
    >
      {h + a} restantes ({h} × {a})
    </span>
  );
}

function ResultadosPage() {
  const { ready, forbidden } = useRequireAuth({ role: "admin" });

  const [seasons, setSeasons] = useState<SeasonOpt[]>([]);
  const [weeksIndex, setWeeksIndex] = useState<WeekEntry[]>([]);
  const [teams, setTeams] = useState<Map<string, string>>(new Map());
  const [seasonId, setSeasonId] = useState("");
  const [week, setWeek] = useState<number | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});
  // jogadores restantes por confronto (lidos da planilha; só jogos não finalizados)
  const [live, setLive] = useState<Record<string, LivePlacar>>({});
  const [liveLoading, setLiveLoading] = useState(false);

  const [preview, setPreview] = useState<{ scope: string; items: PreviewItem[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [report, setReport] = useState<{ ok: number; falhas: number; linhas: string[] } | null>(null);

  // metadados
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [sRes, wRes, tRes] = await Promise.all([
        supabase.from("seasons").select("id, label, start_year, is_current").order("start_year", { ascending: false }),
        callRpc("get_weeks_index"),
        supabase.from("teams").select("id, name"),
      ]);
      const ss = ((sRes.data ?? []) as SeasonOpt[]).slice();
      setSeasons(ss);
      setWeeksIndex((wRes.data ?? []) as WeekEntry[]);
      setTeams(new Map(((tRes.data ?? []) as Team[]).map((t) => [t.id, t.name])));
      const cur = ss.find((s) => s.is_current) ?? ss[0];
      setSeasonId((c) => c || cur?.id || "");
    })();
  }, [ready]);

  const weekOptions = useMemo(
    () => [...new Set(weeksIndex.filter((w) => w.season_id === seasonId).map((w) => w.week_number))].sort((a, b) => a - b),
    [weeksIndex, seasonId],
  );
  useEffect(() => {
    if (weekOptions.length && week == null) setWeek(weekOptions[0]);
  }, [weekOptions, week]);

  async function loadGames() {
    if (!seasonId || week == null) return;
    setLoading(true);
    setOutcomes({});
    setLive({});
    const { data } = await supabase
      .from("games")
      .select("id, game_code, home_team_id, away_team_id, home_score, away_score, status, external_url")
      .eq("season_id", seasonId)
      .eq("week_number", week)
      .eq("is_playoff", false)
      .order("game_code", { ascending: true });
    const lista = (data as unknown as GameRow[]) ?? [];
    setGames(lista);
    setLoading(false);
    void carregarRestantes(lista);
  }

  // Lê as planilhas dos jogos ainda não finalizados e guarda quantos jogadores faltam jogar.
  async function carregarRestantes(lista: GameRow[]) {
    const ids = lista.filter((g) => g.status !== "final" && g.external_url).map((g) => g.id);
    if (!ids.length) {
      setLive({});
      return;
    }
    setLiveLoading(true);
    try {
      const res = await restantesFn({ data: ids });
      setLive(Object.fromEntries(res.map((r) => [r.gameId, r])));
    } catch {
      /* mantém o que já estava na tela */
    } finally {
      setLiveLoading(false);
    }
  }
  useEffect(() => {
    void loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, week]);

  // confrontos agrupados por rodada (game_code)
  const rodadas = useMemo(() => {
    const m = new Map<string, GameRow[]>();
    for (const g of games) {
      const k = g.game_code ?? "—";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [games]);

  function setOutcome(id: string, o: RowOutcome) {
    setOutcomes((prev) => ({ ...prev, [id]: o }));
  }

  // grava um confronto já preparado (ok ou pendente confirmado)
  async function gravar(prep: Extract<PrepareResult, { ok: true }>): Promise<RowOutcome> {
    const { error } = await callRpc("finalizar_confronto", {
      _game_id: prep.meta.gameId,
      _payload: prep.build.payload,
    });
    if (error) return { kind: "error", msg: error.message };
    return { kind: "ok", msg: `Gravado ${prep.homeScore}–${prep.awayScore}` };
  }

  async function finalizarUm(game: GameRow, forcarPendente = false) {
    setOutcome(game.id, { kind: "working" });
    const prep = await prepararFn({ data: game.id });
    if (!prep.ok) {
      setOutcome(game.id, { kind: "error", msg: prep.reason === "sem_planilha" ? "Sem planilha vinculada." : prep.message ?? prep.reason });
      return;
    }
    if (prep.build.unmatched.length) {
      setOutcome(game.id, { kind: "unmatched", names: prep.build.unmatched.map((u) => u.name) });
      return;
    }
    if (prep.anyPending && !forcarPendente) {
      setOutcome(game.id, { kind: "pending_confirm", prep });
      return;
    }
    setOutcome(game.id, await gravar(prep));
    await refreshGame(game.id);
  }

  async function reabrir(game: GameRow) {
    setOutcome(game.id, { kind: "working" });
    const { error } = await callRpc("reabrir_confronto", { _game_id: game.id });
    setOutcome(game.id, error ? { kind: "error", msg: error.message } : { kind: "ok", msg: "Reaberto." });
    await refreshGame(game.id);
  }

  async function refreshGame(id: string) {
    const { data } = await supabase
      .from("games")
      .select("id, game_code, home_team_id, away_team_id, home_score, away_score, status, external_url")
      .eq("id", id)
      .maybeSingle();
    if (data) setGames((prev) => prev.map((g) => (g.id === id ? (data as unknown as GameRow) : g)));
  }

  // ── Lote: preview (rodada/semana) ──────────────────────────────────────────────
  async function abrirPreview(scope: string, alvo: GameRow[]) {
    const pendentes = alvo.filter((g) => g.status !== "final" && g.external_url);
    if (!pendentes.length) {
      setReport({ ok: 0, falhas: 0, linhas: ["Nenhum confronto a finalizar (todos já finais ou sem planilha)."] });
      return;
    }
    setPreviewLoading(true);
    setPreview({ scope, items: [] });
    const preps = await Promise.all(pendentes.map((g) => prepararFn({ data: g.id }).then((p) => ({ g, p }))));
    const items: PreviewItem[] = preps.map(({ g, p }) => {
      const c = classifyPrep(p);
      return { game: g, prep: p, status: c.status, detail: c.detail };
    });
    setPreview({ scope, items });
    setPreviewLoading(false);
  }

  async function confirmarLote() {
    if (!preview) return;
    setGravando(true);
    const linhas: string[] = [];
    let ok = 0;
    let falhas = 0;
    for (const it of preview.items) {
      const nome = `${teams.get(it.game.home_team_id) ?? "?"} × ${teams.get(it.game.away_team_id) ?? "?"}`;
      if (it.prep && it.prep.ok && it.status !== "unmatched") {
        const r = await gravar(it.prep);
        if (r.kind === "ok") {
          ok++;
          linhas.push(`✓ ${nome}: ${it.prep.homeScore}–${it.prep.awayScore}${it.status === "pending" ? " (com pendentes)" : ""}`);
        } else {
          falhas++;
          linhas.push(`✗ ${nome}: ${r.kind === "error" ? r.msg : "erro"}`);
        }
      } else {
        falhas++;
        linhas.push(`• ${nome}: pulado (${it.detail})`);
      }
    }
    setGravando(false);
    setPreview(null);
    setReport({ ok, falhas, linhas });
    await loadGames();
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-3xl">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">Esta área é restrita a administradores da liga.</p>
      </div>
    );
  }
  if (!ready) return null;

  const todosGames = games;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Admin</p>
      <h1 className="mt-1 font-display text-3xl">Resultados — finalizar confrontos</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Lê a planilha de cada confronto, grava no banco e marca como final (a classificação atualiza sozinha).
        Finalizar é idempotente; dá pra reabrir.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Temporada</label>
          <Select value={seasonId} onValueChange={(v) => { setSeasonId(v); setWeek(null); }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Temporada" /></SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}{s.is_current ? " (atual)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Semana</label>
          <Select value={week != null ? String(week) : ""} onValueChange={(v) => setWeek(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Semana" /></SelectTrigger>
            <SelectContent>
              {weekOptions.map((w) => <SelectItem key={w} value={String(w)}>Semana {w}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="default"
          disabled={!todosGames.some((g) => g.status !== "final")}
          onClick={() => abrirPreview(`Semana ${week}`, todosGames)}
        >
          Finalizar a semana toda
        </Button>
        <Button
          variant="outline"
          disabled={liveLoading || !games.some((g) => g.status !== "final" && g.external_url)}
          onClick={() => void carregarRestantes(games)}
        >
          {liveLoading ? "Lendo planilhas…" : "Atualizar restantes"}
        </Button>
      </div>

      {report && (
        <Alert className="mt-6">
          <AlertTitle>Relatório — {report.ok} gravado(s), {report.falhas} pulado(s)/erro</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">{report.linhas.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Carregando confrontos…</p>
      ) : (
        <div className="mt-8 space-y-8">
          {rodadas.map(([code, gs]) => (
            <section key={code}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-xl">{code}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!gs.some((g) => g.status !== "final")}
                  onClick={() => abrirPreview(`Rodada ${code}`, gs)}
                >
                  Finalizar rodada
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                {gs.map((g) => {
                  const o = outcomes[g.id] ?? { kind: "idle" };
                  const isFinal = g.status === "final";
                  return (
                    <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 px-3 py-2 text-sm first:border-t-0">
                      <Link to="/confronto/$gameId" params={{ gameId: g.id }} className="min-w-0 flex-1 truncate hover:underline">
                        {teams.get(g.home_team_id) ?? "?"} <span className="text-muted-foreground">×</span> {teams.get(g.away_team_id) ?? "?"}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">
                        {isFinal ? `${g.home_score}–${g.away_score}` : "—"}
                      </span>
                      {!isFinal && g.external_url && <RestantesTag live={live[g.id]} loading={liveLoading} />}
                      <span className={isFinal ? "rounded bg-[color:var(--court)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--court)]" : "rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"}>
                        {isFinal ? "final" : "a jogar"}
                      </span>
                      {isFinal ? (
                        <Button size="sm" variant="ghost" disabled={o.kind === "working"} onClick={() => reabrir(g)}>Reabrir</Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={o.kind === "working" || !g.external_url} onClick={() => finalizarUm(g)}>
                          {o.kind === "working" ? "…" : "Finalizar"}
                        </Button>
                      )}
                      {o.kind === "ok" && <span className="text-xs text-[color:var(--court)]">{o.msg}</span>}
                      {o.kind === "error" && <span className="text-xs text-destructive">{o.msg}</span>}
                      {o.kind === "unmatched" && (
                        <span className="text-xs text-amber-700">Nomes sem cadastro: {o.names.join(", ")}</span>
                      )}
                      {o.kind === "pending_confirm" && (
                        <span className="flex items-center gap-2 text-xs text-amber-700">
                          Ainda há jogadores sem stats.
                          <Button size="sm" variant="outline" onClick={() => finalizarUm(g, true)}>Fechar assim mesmo</Button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!rodadas.length && <p className="text-sm text-muted-foreground">Nenhum confronto nesta semana.</p>}
        </div>
      )}

      {/* Preview de lote */}
      <AlertDialog open={!!preview} onOpenChange={(o) => !gravando && !o && setPreview(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar — {preview?.scope}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {previewLoading ? (
                  <p>Lendo as planilhas…</p>
                ) : (
                  <>
                    <p className="mb-2">
                      Vou gravar os confrontos marcados como <b>prontos</b>. Os com nome sem cadastro são pulados
                      (corrija o nome e rode de novo). Confira os placares:
                    </p>
                    <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
                      {preview?.items.map((it) => {
                        const nome = `${teams.get(it.game.home_team_id) ?? "?"} × ${teams.get(it.game.away_team_id) ?? "?"}`;
                        const tag =
                          it.status === "ok" ? "✓ pronto" :
                          it.status === "pending" ? "⚠ pronto (pendentes)" :
                          it.status === "unmatched" ? "✗ nomes sem cadastro" :
                          "✗ " + it.status;
                        const color =
                          it.status === "ok" ? "text-[color:var(--court)]" :
                          it.status === "pending" ? "text-amber-700" : "text-destructive";
                        return (
                          <li key={it.game.id} className="flex items-baseline justify-between gap-2">
                            <span className="truncate">{nome}</span>
                            <span className={`flex-none ${color}`}>{tag} · {it.detail}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={gravando}>Cancelar</AlertDialogCancel>
            <Button
              onClick={confirmarLote}
              disabled={gravando || previewLoading || !preview?.items.some((i) => i.prep?.ok && i.status !== "unmatched")}
            >
              {gravando ? "Gravando…" : `Gravar os ${preview?.items.filter((i) => i.prep?.ok && i.status !== "unmatched").length ?? 0} prontos`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
