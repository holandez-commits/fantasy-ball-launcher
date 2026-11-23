// Busca a posição de um jogador no Basketball Reference (Play-By-Play) e aplica a regra da liga.
// Roda no servidor (o BR não libera CORS). Respeita o limite do site (20 requisições/min):
// no máximo 1 requisição a cada ~3,3 s e cache de 6 h por nome.
import { createServerFn } from "@tanstack/react-start";
import { parsearPBP, sugerirPosicao, type SugestaoBR } from "@/lib/bbref-posicao-core";

export type BuscaPosicaoResult =
  | { ok: true; nomeBR: string; url: string; sugestao: SugestaoBR }
  | { ok: false; message: string; candidatos?: { nome: string; url: string }[] };

const BASE = "https://www.basketball-reference.com";
const INTERVALO_MS = 3300;
const CACHE_MS = 6 * 60 * 60 * 1000;

let ultimaRequisicao = 0;
const cache = new Map<string, { t: number; v: BuscaPosicaoResult }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fila: nunca duas requisições ao BR ao mesmo tempo
let fila: Promise<unknown> = Promise.resolve();
function brGet(url: string): Promise<{ status: number; url: string; html: string }> {
  const p = fila.then(() => brGetSeq(url));
  fila = p.catch(() => undefined);
  return p;
}

async function brGetSeq(url: string): Promise<{ status: number; url: string; html: string }> {
  const espera = ultimaRequisicao + INTERVALO_MS - Date.now();
  if (espera > 0) await sleep(espera);
  ultimaRequisicao = Date.now();
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (compatible; BolaPresaBot/1.0; liga privada de fantasy)" },
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

const ehPaginaJogador = (u: string) => /\/players\/[a-z]\/[a-z0-9]+\.html$/.test(new URL(u).pathname);
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function erroHttp(status: number): string {
  if (status === 403 || status === 429)
    return `O Basketball Reference bloqueou ou limitou a consulta (HTTP ${status}). Tente de novo em alguns minutos ou defina a posição manualmente.`;
  return `O Basketball Reference respondeu HTTP ${status}.`;
}

export const buscarPosicaoBRFn = createServerFn({ method: "POST" })
  .inputValidator((nome: string) => String(nome ?? "").trim().slice(0, 80))
  .handler(async ({ data: nome }): Promise<BuscaPosicaoResult> => {
    if (nome.length < 3) return { ok: false, message: "Nome muito curto para buscar." };
    const chave = norm(nome);
    const hit = cache.get(chave);
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;

    const guardar = (v: BuscaPosicaoResult) => {
      if (v.ok) cache.set(chave, { t: Date.now(), v });
      return v;
    };

    try {
      const busca = await brGet(`${BASE}/search/search.fcgi?search=${encodeURIComponent(nome)}`);
      if (busca.status !== 200) return { ok: false, message: erroHttp(busca.status) };

      let pagina = busca;
      if (!ehPaginaJogador(busca.url)) {
        // lista de resultados: só jogadores da NBA (ignora G League), sem repetição
        const achados = new Map<string, string>();
        for (const m of busca.html.matchAll(
          /<div class="search-item-name"[^>]*>[\s\S]*?<a href="(\/players\/[a-z]\/[a-z0-9]+\.html)">([^<]+)<\/a>/g,
        )) {
          if (!achados.has(m[1])) achados.set(m[1], m[2].trim());
        }
        const todos = [...achados.entries()].map(([href, rotulo]) => ({ href, rotulo }));
        if (todos.length === 0) return { ok: false, message: `Não achei "${nome}" no Basketball Reference.` };
        // mesmo nome (sem acento) e ainda ativo (último ano >= temporada anterior)
        const ano = new Date().getFullYear();
        const mesmoNome = todos.filter((c) => norm(c.rotulo.replace(/\s*\([^)]*\)\s*$/, "")) === chave);
        const base = mesmoNome.length > 0 ? mesmoNome : todos;
        const ativos = base.filter((c) => {
          const y = c.rotulo.match(/-(\d{4})\)/);
          return y ? Number(y[1]) >= ano : true;
        });
        const lista = ativos.length > 0 ? ativos : base;
        if (lista.length !== 1) {
          return {
            ok: false,
            message: `Mais de um jogador com esse nome no Basketball Reference. Defina manualmente.`,
            candidatos: lista.slice(0, 5).map((c) => ({ nome: c.rotulo, url: BASE + c.href })),
          };
        }
        pagina = await brGet(BASE + lista[0].href);
        if (pagina.status !== 200) return { ok: false, message: erroHttp(pagina.status) };
      }

      const linhas = parsearPBP(pagina.html);
      if (linhas.length === 0) {
        return { ok: false, message: "A página do jogador não tem a tabela Play-By-Play (sem dados na NBA?)." };
      }
      const h1 = pagina.html.match(/<h1[^>]*>\s*<span>([^<]+)<\/span>/);
      return guardar({
        ok: true,
        nomeBR: h1 ? h1[1].trim() : nome,
        url: pagina.url.split("#")[0] + "#pbp_stats",
        sugestao: sugerirPosicao(linhas),
      });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Falha ao consultar o Basketball Reference." };
    }
  });
