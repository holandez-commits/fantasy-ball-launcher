import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  gvizUrl,
  normalizeNick,
  parseExternalUrl,
  readConfrontoFromGviz,
  type ConfrontoOriented,
} from "../lib/confronto-sheet";
import { espnPlayerUrl } from "../lib/links";
import { FinalizarPartida } from "@/components/FinalizarPartida";

// ─── Types ──────────────────────────────────────────────────────────────────────

type TeamMeta = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sheet_nickname: string | null;
};

type GameMeta = {
  gameId: string;
  status: string;
  weekNumber: number | null;
  planilhaUrl: string | null;
  home: TeamMeta;
  away: TeamMeta;
};

type ConfrontoPayload =
  | { ok: false; reason: "nao_encontrado" | "sem_planilha" | "parse"; message?: string; meta?: GameMeta }
  | {
      ok: true;
      meta: GameMeta;
      data: ConfrontoOriented;
      fetchedAt: number;
      // nome normalizado (normalizeNick) → espn_id, para linkar os jogadores
      espn: Record<string, string>;
    };

// ─── Camada de dados no SERVIDOR (Worker) — mesmo padrão da /classificacao ───────

function serverClient() {
  const url =
    import.meta.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://wfmvjzwkffetqaqbvlib.supabase.co";
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_6mp-_0lhBQnaE_VddFyerA_gBIxN5bH";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  }) as any;
}

// Cache compartilhado (por isolate do Worker): com 24 GMs dando polling, as
// rajadas de leitura de um mesmo confronto colapsam numa só ida ao Google.
// Efêmero por natureza — some quando o isolate recicla. Evoluir p/ KV se preciso.
const gvizCache = new Map<string, { at: number; text: string }>();
const GVIZ_TTL = 25_000;

async function fetchGvizCached(docId: string, gid: string): Promise<string> {
  const ck = `${docId}:${gid}`;
  const now = Date.now();
  const hit = gvizCache.get(ck);
  if (hit && now - hit.at < GVIZ_TTL) return hit.text;
  // URL completa com gid + cache-bust: cada aba é uma URL distinta, sem reuso.
  const res = await fetch(`${gvizUrl(docId, gid)}&_cb=${now}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`gviz HTTP ${res.status}`);
  const text = await res.text();
  gvizCache.set(ck, { at: now, text });
  return text;
}

const TEAM_COLS = "id, name, slug, logo_url, primary_color, sheet_nickname";

// Mapa nome→espn_id (cache de 10 min por isolate). Nome que normaliza para dois
// jogadores é ambíguo e fica sem link. Falha de leitura = sem links, nunca erro.
let espnCache: { at: number; map: Record<string, string> } | null = null;
const ESPN_TTL = 10 * 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadEspnMap(sb: any): Promise<Record<string, string>> {
  const now = Date.now();
  if (espnCache && now - espnCache.at < ESPN_TTL) return espnCache.map;
  try {
    const { data } = await sb.from("players").select("full_name, espn_id");
    const seen = new Map<string, string | null>();
    for (const p of (data ?? []) as { full_name: string; espn_id: string | null }[]) {
      const k = normalizeNick(p.full_name);
      seen.set(k, seen.has(k) ? null : p.espn_id); // colisão → ambíguo
    }
    const map: Record<string, string> = {};
    for (const [k, v] of seen) if (v) map[k] = v;
    espnCache = { at: now, map };
    return map;
  } catch {
    return {};
  }
}

const fetchConfronto = createServerFn({ method: "GET" })
  .inputValidator((gameId: string) => gameId)
  .handler(async ({ data: gameId }): Promise<ConfrontoPayload> => {
    const sb = serverClient();

    const { data: game } = await sb
      .from("games")
      .select("id, status, week_number, external_url, home_team_id, away_team_id")
      .eq("id", gameId)
      .maybeSingle();

    if (!game) return { ok: false, reason: "nao_encontrado" };

    const { data: teams } = await sb
      .from("teams")
      .select(TEAM_COLS)
      .in("id", [game.home_team_id, game.away_team_id]);

    const byId = new Map<string, TeamMeta>((teams ?? []).map((t: TeamMeta) => [t.id, t]));
    const home = byId.get(game.home_team_id);
    const away = byId.get(game.away_team_id);

    const meta: GameMeta = {
      gameId: game.id,
      status: game.status,
      weekNumber: game.week_number,
      planilhaUrl: game.external_url,
      home: home ?? ({ id: game.home_team_id, name: "?", slug: null, logo_url: null, primary_color: null, sheet_nickname: null }),
      away: away ?? ({ id: game.away_team_id, name: "?", slug: null, logo_url: null, primary_color: null, sheet_nickname: null }),
    };

    if (!game.external_url) return { ok: false, reason: "sem_planilha", meta };

    const parsedUrl = parseExternalUrl(game.external_url);
    if (!parsedUrl) return { ok: false, reason: "sem_planilha", meta };

    try {
      const text = await fetchGvizCached(parsedUrl.docId, parsedUrl.gid);
      const data = readConfrontoFromGviz(text, meta.home.sheet_nickname ?? "", meta.away.sheet_nickname ?? "");
      const espn = await loadEspnMap(sb);
      return { ok: true, meta, data, fetchedAt: Date.now(), espn };
    } catch (e) {
      return { ok: false, reason: "parse", message: e instanceof Error ? e.message : String(e), meta };
    }
  });

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/confronto_/$gameId")({
  head: () => ({
    meta: [
      { title: "Confronto — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Resultado ao vivo do confronto." },
    ],
  }),
  loader: async ({ params }) => fetchConfronto({ data: params.gameId }),
  component: ConfrontoPage,
});

const POLL_MS = 40_000;

// ─── Helpers de UI ──────────────────────────────────────────────────────────────

function teamInitials(name: string): string {
  const w = name.trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function TeamBadge({ team, size = 40 }: { team: TeamMeta; size?: number }) {
  const bg = team.primary_color ?? "#374151";
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{ background: bg, width: size, height: size, fontSize: size * 0.32 }}
    >
      {team.logo_url ? (
        <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
      ) : (
        <span>{teamInitials(team.name)}</span>
      )}
    </div>
  );
}

function fmt(v: number | null): string {
  return v === null ? "—" : String(v);
}

// ─── Página ──────────────────────────────────────────────────────────────────────

function ConfrontoPage() {
  const initial = Route.useLoaderData() as ConfrontoPayload;
  const { gameId } = Route.useParams();

  const [payload, setPayload] = useState<ConfrontoPayload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [secsAgo, setSecsAgo] = useState(0);

  const isLive = (payload.ok ? payload.meta.status : payload.meta?.status) === "scheduled";

  // Polling ao vivo (só enquanto o jogo não está final). Também refaz ao focar a aba.
  const lastFetch = useRef<number>(payload.ok ? payload.fetchedAt : Date.now());

  useEffect(() => {
    if (!isLive) return;

    let alive = true;
    async function refetch() {
      if (!alive) return;
      setRefreshing(true);
      try {
        const next = await fetchConfronto({ data: gameId });
        if (!alive) return;
        setPayload(next);
        lastFetch.current = next.ok ? next.fetchedAt : Date.now();
        setSecsAgo(0);
      } catch {
        /* mantém o último payload bom */
      } finally {
        if (alive) setRefreshing(false);
      }
    }

    const poll = setInterval(refetch, POLL_MS);
    const onFocus = () => {
      if (Date.now() - lastFetch.current > 10_000) refetch();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    const tick = setInterval(() => setSecsAgo(Math.round((Date.now() - lastFetch.current) / 1000)), 1000);

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [isLive, gameId]);

  const meta = payload.meta;

  // Recarrega na hora (usado após fechar/reabrir a partida)
  async function reload() {
    setRefreshing(true);
    try {
      const next = await fetchConfronto({ data: gameId });
      setPayload(next);
      lastFetch.current = next.ok ? next.fetchedAt : Date.now();
      setSecsAgo(0);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-14">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Jogos
      </Link>

      {!meta ? (
        <p className="text-sm text-muted-foreground">Confronto não encontrado.</p>
      ) : (
        <>
          {/* Cabeçalho + placar */}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
              {meta.weekNumber != null ? `Semana ${meta.weekNumber}` : "Confronto"}
            </p>
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                Ao vivo
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Encerrado
              </span>
            )}
          </div>

          <Scoreboard payload={payload} />

          <FinalizarPartida
            gameId={meta.gameId}
            status={meta.status}
            homeName={meta.home.name}
            awayName={meta.away.name}
            hasPlanilha={!!meta.planilhaUrl}
            onChanged={reload}
          />

          {/* Estados de erro de leitura */}
          {!payload.ok && payload.reason === "sem_planilha" && (
            <p className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Este confronto ainda não tem planilha vinculada.
            </p>
          )}
          {!payload.ok && payload.reason === "parse" && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-amber-700">Não consegui ler a planilha agora.</p>
              <p className="mt-1 text-muted-foreground">{payload.message}</p>
              {meta.planilhaUrl && (
                <a
                  href={meta.planilhaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[color:var(--court)] hover:underline"
                >
                  Abrir a planilha <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}

          {/* Conteúdo ao vivo */}
          {payload.ok && (
            <>
              <div className="mb-6 mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {payload.data.anyPending
                    ? "Jogo em andamento — alguns titulares ainda sem estatística."
                    : "Dados da planilha do confronto."}
                  {payload.data.tiedCategories > 0 &&
                    ` · ${payload.data.tiedCategories} categoria(s) empatada(s).`}
                </span>
                {isLive && (
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                    {secsAgo < 2 ? "agora" : `há ${secsAgo}s`}
                  </span>
                )}
              </div>

              <CategoryTable payload={payload} />

              <div className="mt-8 grid gap-8">
                <BoxScore title={meta.home.name} side={payload.data.home} espn={payload.espn} />
                <BoxScore title={meta.away.name} side={payload.data.away} espn={payload.espn} />
              </div>
            </>
          )}

          {meta.planilhaUrl && payload.ok && (
            <a
              href={meta.planilhaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-[color:var(--court)]"
            >
              Abrir planilha do confronto <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </>
      )}
    </div>
  );
}

// ─── Placar grande ───────────────────────────────────────────────────────────────

function Scoreboard({ payload }: { payload: ConfrontoPayload }) {
  const meta = payload.meta!;
  const hs = payload.ok ? payload.data.homeScore : null;
  const as = payload.ok ? payload.data.awayScore : null;
  const homeWon = hs != null && as != null && hs > as;
  const awayWon = hs != null && as != null && as > hs;

  const homePending = payload.ok ? payload.data.home.pendingCount : null;
  const awayPending = payload.ok ? payload.data.away.pendingCount : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <TeamSide team={meta.home} align="left" dim={awayWon} />
        <div className="flex flex-none items-center gap-3 md:gap-5">
          <span className={cn("font-display text-4xl tabular-nums md:text-6xl", homeWon && "text-[color:var(--court)]")}>
            {hs ?? "–"}
          </span>
          <span className="text-xl text-muted-foreground md:text-2xl">×</span>
          <span className={cn("font-display text-4xl tabular-nums md:text-6xl", awayWon && "text-[color:var(--court)]")}>
            {as ?? "–"}
          </span>
        </div>
        <TeamSide team={meta.away} align="right" dim={homeWon} />
      </div>

      {payload.ok && (
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/60 pt-3">
          <PendingTag n={homePending!} align="left" />
          <PendingTag n={awayPending!} align="right" />
        </div>
      )}
    </div>
  );
}

function PendingTag({ n, align }: { n: number; align: "left" | "right" }) {
  if (n === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", align === "right" && "text-right")}>
        ✓ todos jogaram
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700",
        align === "right" && "flex-row-reverse",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {n} {n === 1 ? "jogador restante" : "jogadores restantes"}
    </span>
  );
}

function TeamSide({ team, align, dim }: { team: TeamMeta; align: "left" | "right"; dim: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", align === "right" && "flex-row-reverse text-right", dim && "opacity-45")}>
      <TeamBadge team={team} size={44} />
      <div className="min-w-0">
        <p className="truncate font-display text-lg leading-tight tracking-tight md:text-xl">{team.name}</p>
      </div>
    </div>
  );
}

// ─── Tabela de categorias (placar por categoria) ────────────────────────────────

function CategoryTable({ payload }: { payload: Extract<ConfrontoPayload, { ok: true }> }) {
  const { home, away } = payload.data;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {CATEGORIES.map((cat, i) => {
        const h = home.categories[i];
        const a = away.categories[i];
        return (
          <div
            key={cat.key}
            className={cn(
              "grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2 text-sm",
              i % 2 === 0 ? "bg-card" : "bg-muted/30",
            )}
          >
            <span className={cn("text-right tabular-nums", h.won ? "font-bold text-[color:var(--court)]" : "text-muted-foreground")}>
              {h.value}
            </span>
            <span className="w-14 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {cat.label}
            </span>
            <span className={cn("text-left tabular-nums", a.won ? "font-bold text-[color:var(--court)]" : "text-muted-foreground")}>
              {a.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Box score por time ─────────────────────────────────────────────────────────

function BoxScore({
  title,
  side,
  espn,
}: {
  title: string;
  side: ConfrontoOriented["home"];
  espn: Record<string, string>;
}) {
  return (
    <div>
      <h3 className="mb-2 font-display text-lg tracking-tight">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Jogador</th>
              {CATEGORIES.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right font-semibold">
                  {c.label}
                </th>
              ))}
              <th className="border-l border-border px-3 py-2 text-left font-semibold">Reserva</th>
            </tr>
          </thead>
          <tbody>
            {side.players.map((p, idx) => {
              const empty = p.name === null;
              return (
                <tr key={idx} className={cn("border-t border-border/50", (empty || !p.played) && "opacity-40")}>
                  <td className="px-3 py-2">
                    {empty ? (
                      <span className="italic text-muted-foreground">— vaga —</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {espn[normalizeNick(p.name)] ? (
                          <a
                            href={espnPlayerUrl(espn[normalizeNick(p.name)])}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ver na ESPN"
                            className="truncate font-medium hover:text-[color:var(--court)] hover:underline"
                          >
                            {p.name}
                          </a>
                        ) : (
                          <span className="truncate font-medium">{p.name}</span>
                        )}
                        {p.isReserve && (
                          <span
                            title="Reserva entrou no lugar do titular"
                            className="flex-none rounded bg-[color:var(--court)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--court)]"
                          >
                            reserva
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.pts)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.reb)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.ast)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.stl)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.blk)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.three_pm)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(p.turnovers)}</td>
                  <td className="whitespace-nowrap border-l border-border px-3 py-2 text-muted-foreground">
                    {p.reserve ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/20 font-semibold">
              <td className="px-3 py-2 text-left">Total</td>
              {CATEGORIES.map((c, i) => (
                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                  {side.categories[i].value}
                </td>
              ))}
              <td className="border-l border-border px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
