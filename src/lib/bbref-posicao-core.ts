// Posição de jogador pelo Play-By-Play do Basketball Reference (lógica pura, sem rede).
// Regra da liga (desde 2017): jogador com 30+ jogos e 10+ min/jogo na temporada; 30% da posição
// em CADA uma das duas últimas temporadas válidas (não soma). Jogador de 1º ano (só 1 temporada
// válida): 60% naquela temporada. Sem temporada válida: sem sugestão automática.

export const POS_ORDEM = ["PG", "SG", "SF", "PF", "C"] as const;
export const MIN_JOGOS = 30;
export const MIN_MPG = 10;
export const LIMITE_2_TEMP = 30;
export const LIMITE_1_TEMP = 60;

export type LinhaPBP = {
  season: string; // "2025-26"
  team: string; // "NYK", "2TM", "TOT"
  lg: string;
  pos: string; // posição que o BR lista
  g: number;
  mp: number;
  pct: number[]; // % do tempo em PG, SG, SF, PF, C (0-100)
};

export type TemporadaUsada = { season: string; team: string; g: number; mpg: number; pct: number[]; pos: string };

export type SugestaoBR = {
  /** clara: uma posição (ou híbrida de vizinhas) cumpre o critério; as demais precisam de decisão do admin */
  status: "clara" | "ambigua" | "sem_consenso" | "sem_dados";
  sugestao: string | null;
  opcoes: string[];
  temporadas: TemporadaUsada[];
  limite: number;
  regra: string;
};

const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

export function extrairTabelaPBP(html: string): string | null {
  const i = html.indexOf('id="pbp_stats"');
  if (i < 0) return null;
  const start = html.lastIndexOf("<table", i);
  const end = html.indexOf("</table>", i);
  if (start < 0 || end < 0) return null;
  return html.slice(start, end + 8);
}

/** A tabela vem dentro de um comentário HTML na página; a regex funciona sobre o texto cru. */
export function parsearPBP(html: string): LinhaPBP[] {
  const tbl = extrairTabelaPBP(html);
  if (!tbl) return [];
  const b = tbl.indexOf("<tbody");
  const corpo = b >= 0 ? tbl.slice(b) : tbl;
  const out: LinhaPBP[] = [];
  for (const tr of corpo.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells: Record<string, { txt: string; csk: string | null }> = {};
    for (const c of tr[1].matchAll(/<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/g)) {
      const ds = c[1].match(/data-stat="([^"]+)"/);
      if (!ds) continue;
      const csk = c[1].match(/csk="([^"]+)"/);
      cells[ds[1]] = { txt: strip(c[2]), csk: csk ? csk[1] : null };
    }
    const season = cells.year_id?.txt ?? "";
    if (!/^\d{4}-\d{2}$/.test(season)) continue;
    const lg = cells.comp_name_abbr?.txt ?? "NBA";
    if (lg && lg !== "NBA") continue;
    const num = (k: string) => {
      const v = parseFloat((cells[k]?.txt ?? "").replace(/,/g, ""));
      return Number.isFinite(v) ? v : 0;
    };
    const pct = [1, 2, 3, 4, 5].map((n) => {
      const c = cells[`pct_${n}`];
      if (!c) return 0;
      if (c.csk != null && Number.isFinite(parseFloat(c.csk))) return parseFloat(c.csk) * 100;
      const v = parseFloat(c.txt);
      return Number.isFinite(v) ? v : 0;
    });
    out.push({
      season,
      team: cells.team_name_abbr?.txt ?? "",
      lg,
      pos: cells.pos?.txt ?? "",
      g: num("games"),
      mp: num("mp"),
      pct,
    });
  }
  return out;
}

const ehTotal = (t: string) => /^(TOT|\d+TM)$/.test(t);

/** Uma linha por temporada: em troca de time vale a linha total (TOT/2TM/…), não a de cada time. */
export function consolidarTemporadas(rows: LinhaPBP[]): LinhaPBP[] {
  const por = new Map<string, LinhaPBP[]>();
  for (const r of rows) {
    if (!por.has(r.season)) por.set(r.season, []);
    por.get(r.season)!.push(r);
  }
  const out: LinhaPBP[] = [];
  for (const [, lista] of por) {
    const tot = lista.find((r) => ehTotal(r.team));
    out.push(tot ?? [...lista].sort((a, b) => b.mp - a.mp)[0]);
  }
  return out.sort((a, b) => a.season.localeCompare(b.season));
}

const usada = (r: LinhaPBP): TemporadaUsada => ({
  season: r.season,
  team: r.team,
  g: r.g,
  mpg: r.g > 0 ? Math.round((r.mp / r.g) * 10) / 10 : 0,
  pct: r.pct.map((p) => Math.round(p)),
  pos: r.pos,
});

const rotulo = (idx: number[]): string => idx.map((i) => POS_ORDEM[i]).join("/");
const vizinhas = (a: number, b: number) => Math.abs(a - b) === 1;
const argmax = (p: number[]) => p.indexOf(Math.max(...p));

/** Posições singulares e híbridas (vizinhas) possíveis a partir de um conjunto de índices. */
function opcoesDe(idx: number[]): string[] {
  const u = [...new Set(idx)].sort((a, b) => a - b);
  const out: string[] = u.map((i) => POS_ORDEM[i]);
  for (let k = 0; k < u.length; k++)
    for (let m = k + 1; m < u.length; m++) if (vizinhas(u[k], u[m])) out.push(rotulo([u[k], u[m]]));
  return out;
}

export function sugerirPosicao(brutas: LinhaPBP[]): SugestaoBR {
  const temps = consolidarTemporadas(brutas);
  const validas = temps.filter((r) => r.g >= MIN_JOGOS && r.g > 0 && r.mp / r.g >= MIN_MPG);

  if (validas.length === 0) {
    const ult = temps[temps.length - 1];
    return {
      status: "sem_dados",
      sugestao: null,
      opcoes: ult && POS_ORDEM.includes(ult.pos as never) ? [ult.pos] : [],
      temporadas: ult ? [usada(ult)] : [],
      limite: LIMITE_2_TEMP,
      regra: `Nenhuma temporada com ${MIN_JOGOS}+ jogos e ${MIN_MPG}+ min/jogo. Decisão manual${
        ult ? ` (o Basketball Reference lista ${ult.pos} em ${ult.season})` : ""
      }.`,
    };
  }

  const usadas = validas.slice(-2);
  const limite = usadas.length === 2 ? LIMITE_2_TEMP : LIMITE_1_TEMP;
  const nomes = usadas.map((r) => r.season).join(" e ");
  const passa = [0, 1, 2, 3, 4].filter((i) => usadas.every((r) => r.pct[i] >= limite));
  const base = {
    temporadas: usadas.map(usada),
    limite,
  };
  const descricao =
    usadas.length === 2
      ? `Duas últimas temporadas válidas (${nomes}): posições com ${limite}%+ em cada uma.`
      : `Só uma temporada válida (${nomes}): jogador de 1º ano, posição com ${limite}%+.`;

  if (passa.length === 1) {
    const p = POS_ORDEM[passa[0]];
    return { ...base, status: "clara", sugestao: p, opcoes: [p], regra: `${descricao} Resultado: ${p}.` };
  }
  if (passa.length === 2 && vizinhas(passa[0], passa[1])) {
    const p = rotulo(passa);
    return { ...base, status: "clara", sugestao: p, opcoes: [p], regra: `${descricao} Resultado: ${p} (híbrida).` };
  }
  if (passa.length >= 2) {
    return {
      ...base,
      status: "ambigua",
      sugestao: null,
      opcoes: opcoesDe(passa),
      regra: `${descricao} Mais de uma combinação possível: o admin escolhe.`,
    };
  }
  const maiores = usadas.map((r) => argmax(r.pct));
  return {
    ...base,
    status: "sem_consenso",
    sugestao: null,
    opcoes: opcoesDe(maiores),
    regra: `${descricao} Nenhuma posição cumpre o critério: o admin decide.`,
  };
}
