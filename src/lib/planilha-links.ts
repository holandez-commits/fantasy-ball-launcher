// Subir os links das planilhas dos jogos: lê a lista de abas (nome + gid) da planilha
// de uma rodada e casa cada aba "Time A x Time B" com o confronto do banco.
// A leitura é server-side (o Google não libera CORS para o navegador); gravar é a
// RPC definir_links_jogos, que confere has_role('admin') no banco.
import { createServerFn } from "@tanstack/react-start";
import { normalizeNick } from "@/lib/confronto-sheet";

export type AbaPlanilha = { name: string; gid: string };
export type LerAbasResult =
  | { ok: true; docId: string; abas: AbaPlanilha[] }
  | { ok: false; message: string };

export function extractDocId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Strings dentro do JS da página vêm com escapes (\x27, ', \/).
function decodeJsString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

export const lerAbasFn = createServerFn({ method: "POST" })
  .inputValidator((url: string) => url)
  .handler(async ({ data: url }): Promise<LerAbasResult> => {
    const docId = extractDocId(url);
    if (!docId) return { ok: false, message: "Link inválido: não achei o id da planilha." };
    try {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${docId}/htmlview`, {
        cache: "no-store",
        headers: { "user-agent": "Mozilla/5.0 (compatible; BolaPresaBot/1.0)" },
      });
      if (!res.ok) return { ok: false, message: `O Google respondeu HTTP ${res.status}.` };
      const html = await res.text();
      const abas: AbaPlanilha[] = [];
      const seen = new Set<string>();
      for (const m of html.matchAll(/items\.push\(\{name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g)) {
        const gid = m[2];
        if (seen.has(gid)) continue;
        seen.add(gid);
        abas.push({ name: decodeJsString(m[1]), gid });
      }
      if (abas.length === 0) {
        return {
          ok: false,
          message:
            "Não consegui ler as abas. Confira se a planilha está com acesso 'qualquer pessoa com o link pode ver'.",
        };
      }
      return { ok: true, docId, abas };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Falha ao ler a planilha." };
    }
  });

// ─── Casamento aba × confronto (puro) ───────────────────────────────────────────
export const keyOf = (s: string | null | undefined): string => normalizeNick(s).replace(/[^a-z0-9]/g, "");

const IGNORAR = new Set(["stat", "master", "escalacoes"]);

export type JogoParaLink = {
  id: string;
  game_code: string | null;
  home_team_id: string;
  away_team_id: string;
  status: string;
  external_url: string | null;
};

export type LinhaLink = {
  game: JogoParaLink;
  status: "novo" | "igual" | "diferente" | "sem_aba" | "ambigua";
  aba: AbaPlanilha | null;
  url: string | null;
};

/** teamKeys: id do time -> chaves aceitas (apelido da planilha e nome do time, normalizados). */
export function casarAbas(
  docId: string,
  abas: AbaPlanilha[],
  jogos: JogoParaLink[],
  teamKeys: Map<string, Set<string>>,
): { linhas: LinhaLink[]; abasSemJogo: string[] } {
  const pares = abas
    .filter((a) => !IGNORAR.has(keyOf(a.name)))
    .map((a) => {
      const partes = a.name.split(/\s+x\s+/i);
      return { aba: a, lado: partes.length === 2 ? ([keyOf(partes[0]), keyOf(partes[1])] as const) : null };
    });

  const usadas = new Set<string>();
  const linhas: LinhaLink[] = jogos.map((g) => {
    const h = teamKeys.get(g.home_team_id) ?? new Set<string>();
    const a = teamKeys.get(g.away_team_id) ?? new Set<string>();
    const cand = pares.filter(
      (p) => p.lado && ((h.has(p.lado[0]) && a.has(p.lado[1])) || (a.has(p.lado[0]) && h.has(p.lado[1]))),
    );
    if (cand.length === 0) return { game: g, status: "sem_aba", aba: null, url: null };
    if (cand.length > 1) return { game: g, status: "ambigua", aba: null, url: null };
    const aba = cand[0].aba;
    usadas.add(aba.gid);
    const url = `https://docs.google.com/spreadsheets/d/${docId}/edit#gid=${aba.gid}`;
    const status = !g.external_url ? "novo" : g.external_url === url ? "igual" : "diferente";
    return { game: g, status, aba, url };
  });

  const abasSemJogo = pares.filter((p) => !usadas.has(p.aba.gid)).map((p) => p.aba.name);
  return { linhas, abasSemJogo };
}
