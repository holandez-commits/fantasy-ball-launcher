import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
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
import { TimelineSemana, useProjecao, resolverLinhas, type ProjResult } from "@/components/TimelineSemana";

// ─── Types ──────────────────────────────────────────────────────────────────────

type TeamMeta = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sheet_nickname: string | null;
  conference: string | null;
  // campanha na temporada (só jogos final) + posição na conferência
  standing?: { w: number; l: number; d: number; rank: number | null } | null;
};

type GameMeta = {
  gameId: string;
  status: string;
  weekNumber: number | null;
  planilhaUrl: string | null;
  // próximo jogo da semana na ordem da home (só jogos com planilha); null no último
  nextGameId: string | null;
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

const TEAM_COLS = "id, name, slug, logo_url, primary_color, sheet_nickname, conference";

// Campanha (V-E-D) e posição na conferência, mesma regra da tabela de classificação:
// vitórias desc, empates desc, nome. Só times ativos entram no ranking.
// Falha de leitura = sem campanha na tela, nunca erro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStandings(sb: any, seasonId: string | null, teamIds: string[]) {
  const out = new Map<string, NonNullable<TeamMeta["standing"]>>();
  if (!seasonId) return out;
  try {
    const [{ data: rows }, { data: active }] = await Promise.all([
      sb.rpc("get_standings", { season_ids: [seasonId] }),
      sb.from("teams").select("id, name, conference").eq("is_active", true),
    ]);
    const rec = new Map<string, { w: number; d: number; l: number; gp: number }>();
    for (const r of (rows ?? []) as { team_id: string; w: number; d: number; l: number; gp: number }[]) {
      rec.set(r.team_id, { w: Number(r.w), d: Number(r.d), l: Number(r.l), gp: Number(r.gp) });
    }
    const teams = (active ?? []) as { id: string; name: string; conference: string | null }[];
    const get = (id: string) => rec.get(id) ?? { w: 0, d: 0, l: 0, gp: 0 };
    for (const id of teamIds) {
      const me = teams.find((t) => t.id === id);
      const r = get(id);
      let rank: number | null = null;
      if (me?.conference) {
        const conf = teams
          .filter((t) => t.conference === me.conference)
          .sort((a, b) => {
            const A = get(a.id);
            const B = get(b.id);
            if (B.w !== A.w) return B.w - A.w;
            if (B.d !== A.d) return B.d - A.d;
            return a.name.localeCompare(b.name);
          });
        // sem nenhum jogo final na conferência a ordem seria só alfabética: não mostra posição
        if (conf.some((t) => get(t.id).gp > 0)) rank = conf.findIndex((t) => t.id === id) + 1;
      }
      out.set(id, { w: r.w, l: r.l, d: r.d, rank });
    }
  } catch {
    /* sem campanha */
  }
  return out;
}

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
      .select("id, status, week_number, external_url, home_team_id, away_team_id, season_id, is_playoff")
      .eq("id", gameId)
      .maybeSingle();

    if (!game) return { ok: false, reason: "nao_encontrado" };

    // Próximo jogo: mesma consulta e mesma ordem da home (index.tsx), para o "Próximo"
    // seguir a sequência dos cards. Só entram jogos com planilha (os outros não abrem).
    let nextGameId: string | null = null;
    if (game.season_id && game.week_number != null) {
      const { data: semana } = await sb
        .from("games")
        .select("id, external_url")
        .eq("season_id", game.season_id)
        .eq("week_number", game.week_number)
        .eq("is_playoff", game.is_playoff ?? false)
        .order("game_number_in_week" as "week_number", { ascending: true });
      const lista = (semana ?? []) as { id: string; external_url: string | null }[];
      const i = lista.findIndex((g) => g.id === game.id);
      if (i >= 0) nextGameId = lista.slice(i + 1).find((g) => g.external_url)?.id ?? null;
    }

    const { data: teams } = await sb
      .from("teams")
      .select(TEAM_COLS)
      .in("id", [game.home_team_id, game.away_team_id]);

    const byId = new Map<string, TeamMeta>((teams ?? []).map((t: TeamMeta) => [t.id, t]));
    const home = byId.get(game.home_team_id);
    const away = byId.get(game.away_team_id);

    const standings = await loadStandings(sb, game.season_id ?? null, [game.home_team_id, game.away_team_id]);

    const meta: GameMeta = {
      gameId: game.id,
      status: game.status,
      weekNumber: game.week_number,
      planilhaUrl: game.external_url,
      nextGameId,
      home: {
        ...(home ?? { id: game.home_team_id, name: "?", slug: null, logo_url: null, primary_color: null, sheet_nickname: null, conference: null }),
        standing: standings.get(game.home_team_id) ?? null,
      },
      away: {
        ...(away ?? { id: game.away_team_id, name: "?", slug: null, logo_url: null, primary_color: null, sheet_nickname: null, conference: null }),
        standing: standings.get(game.away_team_id) ?? null,
      },
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

// ─── Parcial com provisórios ─────────────────────────────────────────────────────
// Soma, por lado, os reservas provisórios que o box score já mostra (linha "Com reservas
// provisórios") e projeta placar e categorias. Sem nenhum provisório → null e a tela fica
// exatamente como antes.

type ParcialRow = {
  key: string;
  label: string;
  h: number; // planilha
  a: number;
  hp: number; // com provisórios
  ap: number;
  hd: number; // acréscimo dos provisórios
  ad: number;
  ow: "h" | "a" | null; // vencedor na planilha
  pw: "h" | "a" | null; // vencedor com provisórios
};
type Parcial = { rows: ParcialRow[]; homeScore: number; awayScore: number; homeN: number; awayN: number };

function vencedor(h: number, a: number, lowerWins: boolean): "h" | "a" | null {
  if (h === a) return null;
  return (h > a) !== lowerWins ? "h" : "a";
}

function calcParcial(data: ConfrontoOriented, proj: ProjResult): Parcial | null {
  const lado = (side: ConfrontoOriented["home"], l: "home" | "away") => {
    const info = resolverLinhas(proj.data, l, side.players, normalizeNick);
    return {
      n: info.filter((i) => i?.subst).length,
      soma: CATEGORIES.map((_, c) => info.reduce((acc, i) => acc + (i?.delta ? i.delta[c] : 0), 0)),
    };
  };
  const H = lado(data.home, "home");
  const A = lado(data.away, "away");
  if (H.n + A.n === 0) return null;
  const rows = CATEGORIES.map((c, i) => {
    const h = Number(data.home.categories[i].value);
    const a = Number(data.away.categories[i].value);
    const hp = h + H.soma[i];
    const ap = a + A.soma[i];
    return {
      key: c.key,
      label: c.label,
      h,
      a,
      hp,
      ap,
      hd: H.soma[i],
      ad: A.soma[i],
      ow: vencedor(h, a, c.lowerWins),
      pw: vencedor(hp, ap, c.lowerWins),
    };
  });
  return {
    rows,
    homeScore: rows.filter((r) => r.pw === "h").length,
    awayScore: rows.filter((r) => r.pw === "a").length,
    homeN: H.n,
    awayN: A.n,
  };
}

// ─── Página ──────────────────────────────────────────────────────────────────────

// O "Próximo" navega para a mesma rota com outro gameId: o `key` remonta a página,
// senão o estado (payload/polling) ficaria preso no jogo anterior.
function ConfrontoPage() {
  const { gameId } = Route.useParams();
  return <ConfrontoView key={gameId} />;
}

function ConfrontoView() {
  const initial = Route.useLoaderData() as ConfrontoPayload;
  const { gameId } = Route.useParams();

  const [payload, setPayload] = useState<ConfrontoPayload>(initial);
  // motor novo (status das vagas + reservas provisórios); falha = página igual à de antes
  const proj = useProjecao(gameId);
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
  const parcial = payload.ok ? calcParcial(payload.data, proj) : null;

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
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Jogos
        </Link>
        {meta?.nextGameId && (
          <Link
            to="/confronto/$gameId"
            params={{ gameId: meta.nextGameId }}
            title="Próximo jogo da semana"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-[color:var(--court)] hover:bg-accent"
          >
            Próximo <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

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

          <Scoreboard payload={payload} parcial={parcial} />

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

              <CategoryTable payload={payload} parcial={parcial} />

              <div className="mt-8 grid gap-8">
                <BoxScore title={meta.home.name} side={payload.data.home} espn={payload.espn} proj={proj} lado="home" />
                <BoxScore title={meta.away.name} side={payload.data.away} espn={payload.espn} proj={proj} lado="away" />
              </div>
            </>
          )}

          {/* Timeline semanal (motor novo) — complemento; some sozinho se a RPC falhar */}
          <TimelineSemana gameId={meta.gameId} proj={proj} espn={payload.ok ? payload.espn : undefined} />

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

function Scoreboard({ payload, parcial }: { payload: ConfrontoPayload; parcial: Parcial | null }) {
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
        <div className="flex flex-none flex-col items-center gap-2.5">
          <div className="flex items-center gap-3 md:gap-5">
            <span className={cn("font-display text-4xl tabular-nums md:text-6xl", homeWon && "text-[color:var(--court)]")}>
              {hs ?? "–"}
            </span>
            <span className="text-xl text-muted-foreground md:text-2xl">×</span>
            <span className={cn("font-display text-4xl tabular-nums md:text-6xl", awayWon && "text-[color:var(--court)]")}>
              {as ?? "–"}
            </span>
          </div>
          {parcial && (
            <span
              title="Placar se os reservas provisórios forem confirmados"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 md:text-xs"
            >
              Parcial com provisórios
              <span className="font-display text-base font-medium tabular-nums leading-none md:text-lg">
                {parcial.homeScore} × {parcial.awayScore}
              </span>
            </span>
          )}
        </div>
        <TeamSide team={meta.away} align="right" dim={homeWon} />
      </div>

      {payload.ok && (
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <PendingTag n={homePending!} align="left" />
            <ProvTag n={parcial?.homeN ?? 0} />
          </div>
          <div className="flex flex-row-reverse flex-wrap items-center gap-2">
            <PendingTag n={awayPending!} align="right" />
            <ProvTag n={parcial?.awayN ?? 0} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProvTag({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
      {n} {n === 1 ? "reserva provisório" : "reservas provisórios"}
    </span>
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
        {team.standing && (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {team.standing.w}-{team.standing.d}-{team.standing.l}
            {team.standing.rank != null && team.conference
              ? ` · ${team.standing.rank}º na ${team.conference}`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Tabela de categorias (placar por categoria) ────────────────────────────────

function CategoryTable({
  payload,
  parcial,
}: {
  payload: Extract<ConfrontoPayload, { ok: true }>;
  parcial: Parcial | null;
}) {
  const { home, away } = payload.data;
  const homeName = payload.meta.home.name;
  const awayName = payload.meta.away.name;
  // Visão da tabela: só existe a escolha quando há provisórios; senão é sempre a planilha.
  const [view, setView] = useState<"planilha" | "prov">("planilha");
  const prov = !!parcial && view === "prov";

  const rows = CATEGORIES.map((c, i) => {
    const pr = parcial?.rows[i];
    const hv = prov && pr ? pr.hp : Number(home.categories[i].value);
    const av = prov && pr ? pr.ap : Number(away.categories[i].value);
    const w = vencedor(hv, av, c.lowerWins);
    const lead = Math.abs(hv - av);
    const lider = w === "h" ? homeName : awayName;
    const outro = w === "h" ? awayName : homeName;
    const title =
      w === null
        ? undefined
        : c.lowerWins
          ? `${lider} pode cometer mais ${lead} turnover${lead === 1 ? "" : "s"} antes de empatar`
          : `${outro} precisa de ${lead} para empatar e ${lead + 1} para virar`;
    return { key: c.key, label: c.label, hv, av, w, lead, title, flip: !!pr && pr.ow !== pr.pw };
  });

  const winCls = prov ? "font-bold text-amber-800 dark:text-amber-300" : "font-bold text-[color:var(--court)]";
  const tagCls = prov
    ? "bg-amber-500/25 text-amber-900 dark:text-amber-200"
    : "bg-[color:var(--court)]/10 text-[color:var(--court)]";

  const Tag = ({ r }: { r: (typeof rows)[number] }) => (
    <span title={r.title} aria-label={r.title} className={cn("cursor-help rounded-full px-1.5 py-0.5 text-[11px] font-semibold", tagCls)}>
      +{r.lead}
    </span>
  );

  return (
    <div>
      {parcial && (
        <div className="mb-2 flex justify-end">
          <div role="group" aria-label="Visão da tabela" className="inline-flex gap-0.5 rounded-full bg-muted p-0.5">
            <button
              type="button"
              aria-pressed={!prov}
              onClick={() => setView("planilha")}
              className={cn(
                "min-h-9 rounded-full px-4 text-xs font-semibold transition-colors",
                !prov ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Planilha
            </button>
            <button
              type="button"
              aria-pressed={prov}
              onClick={() => setView("prov")}
              className={cn(
                "min-h-9 rounded-full px-4 text-xs font-semibold transition-colors",
                prov
                  ? "bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/25 dark:text-amber-100"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Com provisórios
            </button>
          </div>
        </div>
      )}

      <div className={cn("overflow-hidden rounded-lg border", prov ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card")}>
        {rows.map((r, i) => (
          <div
            key={r.key}
            className={cn("grid h-10 grid-cols-[1fr_4.5rem_1fr] items-center text-sm tabular-nums", i % 2 === 1 && "bg-muted/30")}
          >
            <div className="flex items-center justify-end gap-2.5 px-4">
              {r.w === "h" && <Tag r={r} />}
              <span className={r.w === "h" ? winCls : "text-muted-foreground"}>{r.hv}</span>
            </div>
            <div className="flex items-center justify-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {r.label}
              {r.flip && (
                <span
                  title="Muda de resultado quando os provisórios entram"
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                />
              )}
            </div>
            <div className="flex items-center gap-2.5 px-4">
              <span className={r.w === "a" ? winCls : "text-muted-foreground"}>{r.av}</span>
              {r.w === "a" && <Tag r={r} />}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">+N</span> ao lado de quem lidera: o adversário precisa de N para
          empatar e N+1 para virar (passe o mouse para ver a frase). Em TO é o contrário: quantos turnovers a mais o líder
          ainda pode cometer antes de empatar.
        </p>
        {parcial && (
          <p>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
            Categoria que muda de resultado com os provisórios. Provisório = reserva cobrindo vaga cujo titular ainda pode
            jogar; se ele entrar em quadra, o número volta para o titular.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Box score por time ─────────────────────────────────────────────────────────

function BoxScore({
  title,
  side,
  espn,
  proj,
  lado,
}: {
  title: string;
  side: ConfrontoOriented["home"];
  espn: Record<string, string>;
  proj: ProjResult;
  lado: "home" | "away";
}) {
  // status de cada vaga (motor novo) casado pelo nome com a linha da planilha
  const info = resolverLinhas(proj.data, lado, side.players, normalizeNick);
  const nSubst = info.filter((i) => i?.subst).length;
  const somaSubst = [0, 1, 2, 3, 4, 5, 6].map((c) => info.reduce((acc, i) => acc + (i?.delta ? i.delta[c] : 0), 0));
  return (
    <div>
      <h3 className="mb-2 font-display text-lg tracking-tight">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        {/* table-fixed + colgroup: as duas tabelas (casa/fora) têm exatamente as mesmas larguras de coluna,
            independente do tamanho dos nomes; o nome do jogador ocupa o espaço que sobra. */}
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup>
            <col />
            {CATEGORIES.map((c) => (
              <col key={c.key} className="w-[52px]" />
            ))}
            <col className="w-[180px]" />
          </colgroup>
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
              const inf = info[idx];
              const sub = inf?.subst ?? null;
              return (
                <tr key={idx} className={cn("border-t border-border/50", (empty || !p.played) && !sub && !inf && "opacity-40")}>
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
                    {inf && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-tight opacity-100">
                        <span className={cn("flex-none rounded px-1 py-0.5 font-medium", inf.chip.cls)}>{inf.chip.texto}</span>
                        {inf.detalhe && <span className="truncate font-medium text-foreground/75">{inf.detalhe}</span>}
                      </span>
                    )}
                  </td>
                  {([p.pts, p.reb, p.ast, p.stl, p.blk, p.three_pm, p.turnovers] as (number | null)[]).map((v, c) => (
                    <td
                      key={c}
                      className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        sub && "italic text-amber-700 dark:text-amber-300",
                        !sub && !p.played && inf && "opacity-40",
                      )}
                      title={sub ? "Dados do reserva (provisório)" : undefined}
                    >
                      {sub ? sub[c] : fmt(v)}
                    </td>
                  ))}
                  <td className={cn("truncate border-l border-border px-3 py-2 text-muted-foreground", !sub && !p.played && inf && "opacity-50")} title={p.reserve ?? undefined}>
                    {p.reserve && espn[normalizeNick(p.reserve)] ? (
                      <a
                        href={espnPlayerUrl(espn[normalizeNick(p.reserve)])}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ver na ESPN"
                        className="hover:text-[color:var(--court)] hover:underline"
                      >
                        {p.reserve}
                      </a>
                    ) : (
                      (p.reserve ?? "—")
                    )}
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
            {nSubst > 0 && (
              <tr className="border-t border-border/50 bg-amber-500/5 text-amber-700 dark:text-amber-300">
                <td className="px-3 py-1.5 text-left text-xs font-medium">Com reservas provisórios ({nSubst})</td>
                {CATEGORIES.map((c, i) => (
                  <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                    {Number(side.categories[i].value) + somaSubst[i]}
                  </td>
                ))}
                <td className="border-l border-border px-3 py-1.5" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
