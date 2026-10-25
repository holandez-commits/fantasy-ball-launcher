// Camada SERVIDOR do confronto (roda só dentro de createServerFn): lê a planilha
// via gviz, resolve nome→player_id contra o banco e monta o payload de
// finalização. Mantém a leitura server-side (o gviz não libera CORS para o
// browser) e centraliza o que a tela ao vivo e a tela admin compartilham.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import {
  buildPersistPayload,
  gvizUrl,
  normalizeNick,
  parseExternalUrl,
  readConfrontoFromGviz,
  type BuildPayloadResult,
  type ConfrontoOriented,
} from "./confronto-sheet";

// Cliente só-servidor (mesmo padrão da /classificacao): publishable + fallback.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverClient(): any {
  const url =
    import.meta.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://wfmvjzwkffetqaqbvlib.supabase.co";
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_6mp-_0lhBQnaE_VddFyerA_gBIxN5bH";
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  }) as any;
}

// Cache compartilhado por isolate do Worker: colapsa rajadas de polling do mesmo
// confronto. `fresh` ignora o cache (usado ao finalizar, pra leitura definitiva).
const gvizCache = new Map<string, { at: number; text: string }>();
const GVIZ_TTL = 25_000;

export async function fetchGviz(docId: string, gid: string, fresh = false): Promise<string> {
  const ck = `${docId}:${gid}`;
  const now = Date.now();
  if (!fresh) {
    const hit = gvizCache.get(ck);
    if (hit && now - hit.at < GVIZ_TTL) return hit.text;
  }
  const res = await fetch(`${gvizUrl(docId, gid)}&_cb=${now}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`gviz HTTP ${res.status}`);
  const text = await res.text();
  gvizCache.set(ck, { at: now, text });
  return text;
}

export type TeamMeta = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sheet_nickname: string | null;
};

export type GameMeta = {
  gameId: string;
  gameCode: string | null;
  seasonId: string;
  status: string;
  weekNumber: number | null;
  planilhaUrl: string | null;
  home: TeamMeta;
  away: TeamMeta;
};

const TEAM_COLS = "id, name, slug, logo_url, primary_color, sheet_nickname";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadGameMeta(sb: any, gameId: string): Promise<GameMeta | null> {
  const { data: game } = await sb
    .from("games")
    .select("id, game_code, season_id, status, week_number, external_url, home_team_id, away_team_id")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) return null;

  const { data: teams } = await sb.from("teams").select(TEAM_COLS).in("id", [game.home_team_id, game.away_team_id]);
  const byId = new Map<string, TeamMeta>((teams ?? []).map((t: TeamMeta) => [t.id, t]));
  const fallback = (id: string): TeamMeta => ({ id, name: "?", slug: null, logo_url: null, primary_color: null, sheet_nickname: null });

  return {
    gameId: game.id,
    gameCode: game.game_code,
    seasonId: game.season_id,
    status: game.status,
    weekNumber: game.week_number,
    planilhaUrl: game.external_url,
    home: byId.get(game.home_team_id) ?? fallback(game.home_team_id),
    away: byId.get(game.away_team_id) ?? fallback(game.away_team_id),
  };
}

// Lê a planilha do confronto e orienta para home/away (casa por sheet_nickname).
export async function readConfronto(meta: GameMeta, fresh = false): Promise<ConfrontoOriented> {
  if (!meta.planilhaUrl) throw new Error("Confronto sem planilha vinculada (external_url).");
  const u = parseExternalUrl(meta.planilhaUrl);
  if (!u) throw new Error("external_url em formato inesperado.");
  const text = await fetchGviz(u.docId, u.gid, fresh);
  return readConfrontoFromGviz(text, meta.home.sheet_nickname ?? "", meta.away.sheet_nickname ?? "");
}

// Resolvedor nome→player_id por full_name normalizado (sem acento/caixa). Nome
// que normaliza para dois jogadores vira ambíguo (null) e será reportado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildPlayerResolver(sb: any): Promise<(name: string) => string | null> {
  const { data } = await sb.from("players").select("id, full_name");
  const map = new Map<string, string | null>();
  for (const p of (data ?? []) as { id: string; full_name: string }[]) {
    const k = normalizeNick(p.full_name);
    map.set(k, map.has(k) ? null : p.id); // colisão → ambíguo
  }
  return (name: string) => map.get(normalizeNick(name)) ?? null;
}

// ─── Placares ao vivo em lote (Fase 2: cards da home) ───────────────────────────
// Lê vários confrontos de uma vez (2 queries + N leituras de planilha em paralelo,
// com o cache compartilhado). Só o placar — leve o bastante pro card da home.
export type LivePlacar = {
  gameId: string;
  ok: boolean;
  homeScore?: number;
  awayScore?: number;
  anyPending?: boolean;
  homePending?: number; // jogadores do mandante ainda sem stats
  awayPending?: number; // jogadores do visitante ainda sem stats
  tiedCategories?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function placaresAoVivo(sb: any, gameIds: string[]): Promise<LivePlacar[]> {
  if (!gameIds.length) return [];
  const { data: games } = await sb
    .from("games")
    .select("id, external_url, home_team_id, away_team_id")
    .in("id", gameIds);
  const list = (games ?? []) as { id: string; external_url: string | null; home_team_id: string; away_team_id: string }[];

  const teamIds = [...new Set(list.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teams } = await sb.from("teams").select("id, sheet_nickname").in("id", teamIds);
  const nick = new Map<string, string>(((teams ?? []) as { id: string; sheet_nickname: string | null }[]).map((t) => [t.id, t.sheet_nickname ?? ""]));

  return Promise.all(
    list.map(async (g): Promise<LivePlacar> => {
      try {
        if (!g.external_url) return { gameId: g.id, ok: false };
        const u = parseExternalUrl(g.external_url);
        if (!u) return { gameId: g.id, ok: false };
        const text = await fetchGviz(u.docId, u.gid, false);
        const data = readConfrontoFromGviz(text, nick.get(g.home_team_id) ?? "", nick.get(g.away_team_id) ?? "");
        return {
          gameId: g.id,
          ok: true,
          homeScore: data.homeScore,
          awayScore: data.awayScore,
          anyPending: data.anyPending,
          homePending: data.home.pendingCount,
          awayPending: data.away.pendingCount,
          tiedCategories: data.tiedCategories,
        };
      } catch {
        return { gameId: g.id, ok: false };
      }
    }),
  );
}

export type PrepareResult =
  | { ok: false; reason: "nao_encontrado" | "sem_planilha" | "parse"; message?: string; meta?: GameMeta }
  | {
      ok: true;
      meta: GameMeta;
      homeScore: number;
      awayScore: number;
      tiedCategories: number;
      anyPending: boolean;
      build: BuildPayloadResult; // payload + unmatched
    };

// Lê a planilha, resolve nomes e monta o payload — SEM gravar. É o que a tela
// admin usa pra pré-visualizar e decidir (grava via RPC finalizar_confronto).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function prepareFinalizacao(sb: any, gameId: string, playedOn: string): Promise<PrepareResult> {
  const meta = await loadGameMeta(sb, gameId);
  if (!meta) return { ok: false, reason: "nao_encontrado" };
  if (!meta.planilhaUrl) return { ok: false, reason: "sem_planilha", meta };

  let data: ConfrontoOriented;
  try {
    data = await readConfronto(meta, true); // fresh: leitura definitiva
  } catch (e) {
    return { ok: false, reason: "parse", message: e instanceof Error ? e.message : String(e), meta };
  }

  const resolve = await buildPlayerResolver(sb);
  const build = buildPersistPayload(data, {
    homeTeamId: meta.home.id,
    awayTeamId: meta.away.id,
    playedOn,
    resolvePlayer: resolve,
  });

  return {
    ok: true,
    meta,
    homeScore: data.homeScore,
    awayScore: data.awayScore,
    tiedCategories: data.tiedCategories,
    anyPending: data.anyPending,
    build,
  };
}
