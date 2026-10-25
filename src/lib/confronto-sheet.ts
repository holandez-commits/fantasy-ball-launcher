// Leitura das planilhas de confronto (Google Sheets via gviz) — lógica PURA,
// sem dependências de React/servidor, para poder ser testada isoladamente e
// reusada tanto na tela ao vivo (Fase 1) quanto na persistência "finalizar"
// (Fase 3). O mapeamento aqui é o mesmo do import histórico.
//
// Layout confirmado (22/10, 12 confrontos reais da Semana 1):
//   colunas: A=nome | B=Pontos | C=Rebotes | D=Assistências | E=Roubos |
//            F=Tocos | G=Bolas de 3 | H=Turnovers | I=(flag) | J=reserva
//   linhas : bloco do time de cima (titulares) -> "Total" -> linha de
//            vencedor-de-categoria -> linha divisória (col A = apelido do time
//            de baixo, col J = "Reservas") -> bloco de baixo -> "Total" -> ...
//
// Regras de preenchimento (confirmadas com o dono da liga, s15):
//   • Reserva entrou: quando o titular não joga, a coluna A passa a mostrar o
//     nome do reserva — o MESMO que está na coluna J daquela linha. Então
//     A == J (na mesma linha) sinaliza "reserva contando".
//   • Posição vazia: quando nem titular nem reserva jogam, a linha fica
//     totalmente em branco (sem nome e sem números).
//
// IMPORTANTE: a ordem cima/baixo da planilha NÃO corresponde a home/away do
// banco (varia por confronto). Casar SEMPRE por sheet_nickname normalizado.

// ─── Categorias (ordem fixa das colunas B..H) ──────────────────────────────────
// `key` casa com game_category_results.category_key; `stat` com as colunas de
// player_game_stats. `lowerWins` = Turnovers (menos é melhor).
export const CATEGORIES = [
  { key: "pts", stat: "pts", col: 1, label: "PTS", lowerWins: false },
  { key: "reb", stat: "reb", col: 2, label: "REB", lowerWins: false },
  { key: "ast", stat: "ast", col: 3, label: "AST", lowerWins: false },
  { key: "stl", stat: "stl", col: 4, label: "ROU", lowerWins: false },
  { key: "blk", stat: "blk", col: 5, label: "TOC", lowerWins: false },
  { key: "3pm", stat: "three_pm", col: 6, label: "3PT", lowerWins: false },
  { key: "to", stat: "turnovers", col: 7, label: "TO", lowerWins: true },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export type PlayerLine = {
  name: string | null; // null = posição vazia (nem titular nem reserva jogaram)
  reserve: string | null; // reserva designado da posição (coluna J)
  isReserve: boolean; // o reserva entrou (nome que conta == coluna J)
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  three_pm: number | null;
  turnovers: number | null;
  played: boolean; // tem ao menos uma stat lançada
};

export type CategoryResult = {
  key: CategoryKey;
  label: string;
  value: number; // total do time na categoria
  won: boolean; // venceu a categoria (false em empate)
};

export type SideResult = {
  nickname: string; // apelido como veio da planilha
  players: PlayerLine[];
  categories: CategoryResult[];
  score: number; // nº de categorias vencidas
  pendingCount: number; // jogadores presentes ainda sem stats (faltam jogar)
};

export type Confronto = {
  top: SideResult;
  bottom: SideResult;
  tiedCategories: number; // categorias empatadas (não contam placar)
  anyPending: boolean; // algum jogador presente ainda sem stats (em andamento)
};

// Confronto já orientado para o banco (home/away), via casamento por nickname.
export type ConfrontoOriented = {
  home: SideResult;
  away: SideResult;
  homeScore: number;
  awayScore: number;
  tiedCategories: number;
  anyPending: boolean;
};

type Cell = string | number | null;
type Table = { cols: { label: string }[]; rows: Cell[][] };

// ─── Normalização (casar planilha ↔ banco: apelidos e nomes) ────────────────────
export function normalizeNick(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[.'’`´]/g, "") // pontos e apóstrofos: "C.J." == "CJ", "P.J." == "PJ"
    .replace(/-/g, " ") // hífen vira espaço: "Karl-Anthony" == "Karl Anthony"
    .replace(/\s+/g, " ")
    .trim();
}

// ─── gviz: descascar o wrapper JSONP e devolver a tabela ────────────────────────
export function parseGvizText(text: string): Table {
  // formato: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error("Resposta do gviz em formato inesperado (sem setResponse).");
  const parsed = JSON.parse(m[1]);
  if (parsed.status !== "ok") {
    const msg = parsed.errors?.[0]?.detailed_message ?? parsed.status ?? "erro";
    throw new Error(`gviz retornou status '${parsed.status}': ${msg}`);
  }
  const cols = (parsed.table?.cols ?? []).map((c: { label?: string }) => ({ label: c.label ?? "" }));
  const rows: Cell[][] = (parsed.table?.rows ?? []).map((r: { c: ({ v: Cell } | null)[] }) =>
    r.c.map((cell) => (cell ? (cell.v ?? null) : null)),
  );
  return { cols, rows };
}

function num(cell: Cell): number | null {
  if (cell === null || cell === "") return null;
  const n = typeof cell === "number" ? cell : Number(cell);
  return Number.isFinite(n) ? n : null;
}

function str(cell: Cell): string | null {
  if (typeof cell !== "string") return null;
  const t = cell.trim();
  return t ? t : null;
}

function playerFromRow(row: Cell[]): PlayerLine {
  const name = str(row[0]);
  const reserve = str(row[9]);
  const vals = CATEGORIES.map((c) => num(row[c.col]));
  const played = vals.some((v) => v !== null);
  // Reserva entrou quando o nome que conta é o mesmo da coluna de reservas.
  const isReserve = !!name && !!reserve && normalizeNick(name) === normalizeNick(reserve);
  return {
    name,
    reserve,
    isReserve,
    pts: vals[0],
    reb: vals[1],
    ast: vals[2],
    stl: vals[3],
    blk: vals[4],
    three_pm: vals[5],
    turnovers: vals[6],
    played,
  };
}

// Linhas de um bloco → slots (posições). No layout real cada bloco tem as mesmas
// 6 linhas de posição entre o início e o "Total", então mantemos todas: uma linha
// em branco é uma posição vazia (ninguém jogou), não é descartada.
function slotsFrom(rows: Cell[][], start: number, end: number): PlayerLine[] {
  return rows.slice(start, end).map(playerFromRow);
}

// ─── Parser estrutural (por marcadores, não por índice fixo) ────────────────────
export function parseConfrontoTable(table: Table): {
  topNick: string;
  bottomNick: string;
  top: { players: PlayerLine[]; totals: (number | null)[] };
  bottom: { players: PlayerLine[]; totals: (number | null)[] };
} {
  const { rows, cols } = table;
  const isTotal = (r: Cell[]) => typeof r[0] === "string" && r[0].trim().toLowerCase() === "total";

  const totalIdx: number[] = [];
  rows.forEach((r, i) => {
    if (isTotal(r)) totalIdx.push(i);
  });
  if (totalIdx.length < 2) {
    throw new Error(`Esperava 2 linhas 'Total', achei ${totalIdx.length}.`);
  }
  const [idxTotal1, idxTotal2] = [totalIdx[0], totalIdx[1]];

  // Linha divisória entre os dois Totais: col J === "Reservas" (col A = apelido de baixo).
  let idxDiv = -1;
  for (let i = idxTotal1 + 1; i < idxTotal2; i++) {
    const j = rows[i][9];
    if (typeof j === "string" && j.trim().toLowerCase() === "reservas") {
      idxDiv = i;
      break;
    }
  }
  if (idxDiv === -1) {
    // fallback: alguma linha entre os totais com col A string não-vazia
    for (let i = idxTotal1 + 1; i < idxTotal2; i++) {
      if (typeof rows[i][0] === "string" && String(rows[i][0]).trim()) {
        idxDiv = i;
        break;
      }
    }
  }
  if (idxDiv === -1) throw new Error("Não achei a linha divisória entre os dois blocos.");

  const totalsOf = (row: Cell[]) => CATEGORIES.map((c) => num(row[c.col]));

  // Apelido de cima vem do título "{cima} x {baixo} {cima}"; o de baixo, da divisória.
  const title = cols[0]?.label ?? "";
  const topNick = title.split(/\s+x\s+/i)[0]?.trim() || "";
  const bottomNick = String(rows[idxDiv][0] ?? "").trim();

  return {
    topNick,
    bottomNick,
    top: { players: slotsFrom(rows, 0, idxTotal1), totals: totalsOf(rows[idxTotal1]) },
    bottom: { players: slotsFrom(rows, idxDiv + 1, idxTotal2), totals: totalsOf(rows[idxTotal2]) },
  };
}

// ─── Placar por categoria (recalculado dos totais; empate não pontua) ───────────
function categoriesFor(
  myTotals: (number | null)[],
  otherTotals: (number | null)[],
): { categories: CategoryResult[]; score: number } {
  const categories = CATEGORIES.map((c, i) => {
    const mine = myTotals[i];
    const other = otherTotals[i];
    let won = false;
    if (mine !== null && other !== null && mine !== other) {
      won = c.lowerWins ? mine < other : mine > other;
    }
    return { key: c.key, label: c.label, value: mine ?? 0, won };
  });
  return { categories, score: categories.filter((c) => c.won).length };
}

export function buildConfronto(table: Table): Confronto {
  const p = parseConfrontoTable(table);
  const topCats = categoriesFor(p.top.totals, p.bottom.totals);
  const bottomCats = categoriesFor(p.bottom.totals, p.top.totals);

  // empate numa categoria = ambos têm total e são iguais
  let tied = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const a = p.top.totals[i];
    const b = p.bottom.totals[i];
    if (a !== null && b !== null && a === b) tied++;
  }

  // "pendente" = jogador presente (titular ou reserva) ainda sem stats; posição
  // vazia (name null) NÃO conta, pois ali ninguém vai pontuar.
  const pending = (pls: PlayerLine[]) => pls.filter((pl) => pl.name !== null && !pl.played).length;
  const topPending = pending(p.top.players);
  const bottomPending = pending(p.bottom.players);

  return {
    top: { nickname: p.topNick, players: p.top.players, categories: topCats.categories, score: topCats.score, pendingCount: topPending },
    bottom: { nickname: p.bottomNick, players: p.bottom.players, categories: bottomCats.categories, score: bottomCats.score, pendingCount: bottomPending },
    tiedCategories: tied,
    anyPending: topPending + bottomPending > 0,
  };
}

// ─── Orientar para home/away do banco (casar por nickname) ──────────────────────
export function orientConfronto(
  c: Confronto,
  homeNick: string,
  awayNick: string,
): ConfrontoOriented {
  const h = normalizeNick(homeNick);
  const a = normalizeNick(awayNick);
  const topN = normalizeNick(c.top.nickname);
  const botN = normalizeNick(c.bottom.nickname);

  let home: SideResult;
  let away: SideResult;
  if (topN === h && botN === a) {
    home = c.top;
    away = c.bottom;
  } else if (topN === a && botN === h) {
    home = c.bottom;
    away = c.top;
  } else {
    throw new Error(
      `Apelidos da planilha ("${c.top.nickname}", "${c.bottom.nickname}") não casaram com os do confronto ("${homeNick}", "${awayNick}").`,
    );
  }
  return {
    home,
    away,
    homeScore: home.score,
    awayScore: away.score,
    tiedCategories: c.tiedCategories,
    anyPending: c.anyPending,
  };
}

// ─── Atalho de alto nível: texto gviz + apelidos → confronto orientado ──────────
export function readConfrontoFromGviz(
  gvizText: string,
  homeNick: string,
  awayNick: string,
): ConfrontoOriented {
  return orientConfronto(buildConfronto(parseGvizText(gvizText)), homeNick, awayNick);
}

// ─── Montar payload de persistência (Fase 3: "finalizar") ───────────────────────
// Converte o confronto lido + um resolvedor nome→player_id no payload que a RPC
// finalizar_confronto grava. Jogadores presentes (name != null) viram linhas de
// player_game_stats; stats em branco contam 0. Nome que não casa entra em
// `unmatched` e o chamador aborta (não grava pela metade).

export type PersistPlayerRow = {
  team_id: string;
  player_id: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  turnovers: number;
  lineup_order: number;
};

export type PersistCategoryRow = {
  team_id: string;
  category_key: CategoryKey;
  value: number;
  won_category: boolean;
};

export type PersistPayload = {
  home_score: number;
  away_score: number;
  tied_categories: number;
  played_on: string; // YYYY-MM-DD
  players: PersistPlayerRow[];
  categories: PersistCategoryRow[];
};

export type BuildPayloadResult = {
  payload: PersistPayload;
  unmatched: { team_id: string; name: string }[]; // nomes sem player_id (abortar)
};

function sideRows(
  side: SideResult,
  teamId: string,
  resolvePlayer: (name: string) => string | null,
  out: { players: PersistPlayerRow[]; categories: PersistCategoryRow[]; unmatched: { team_id: string; name: string }[] },
) {
  let order = 0;
  for (const p of side.players) {
    if (p.name === null) continue; // posição vazia: não gera linha
    order += 1;
    const playerId = resolvePlayer(p.name);
    if (!playerId) {
      out.unmatched.push({ team_id: teamId, name: p.name });
      continue;
    }
    out.players.push({
      team_id: teamId,
      player_id: playerId,
      pts: p.pts ?? 0,
      reb: p.reb ?? 0,
      ast: p.ast ?? 0,
      stl: p.stl ?? 0,
      blk: p.blk ?? 0,
      three_pm: p.three_pm ?? 0,
      turnovers: p.turnovers ?? 0,
      lineup_order: order,
    });
  }
  for (const c of side.categories) {
    out.categories.push({ team_id: teamId, category_key: c.key, value: c.value, won_category: c.won });
  }
}

export function buildPersistPayload(
  c: ConfrontoOriented,
  opts: { homeTeamId: string; awayTeamId: string; playedOn: string; resolvePlayer: (name: string) => string | null },
): BuildPayloadResult {
  const out = {
    players: [] as PersistPlayerRow[],
    categories: [] as PersistCategoryRow[],
    unmatched: [] as { team_id: string; name: string }[],
  };
  sideRows(c.home, opts.homeTeamId, opts.resolvePlayer, out);
  sideRows(c.away, opts.awayTeamId, opts.resolvePlayer, out);
  return {
    payload: {
      home_score: c.homeScore,
      away_score: c.awayScore,
      tied_categories: c.tiedCategories,
      played_on: opts.playedOn,
      players: out.players,
      categories: out.categories,
    },
    unmatched: out.unmatched,
  };
}

// ─── Extrair {docId, gid} do external_url ───────────────────────────────────────
export function parseExternalUrl(url: string): { docId: string; gid: string } | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  if (!idMatch || !gidMatch) return null;
  return { docId: idMatch[1], gid: gidMatch[1] };
}

export function gvizUrl(docId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:json&gid=${gid}`;
}
