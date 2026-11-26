import { useCallback, useEffect, useState } from "react";
import { callRpc } from "@/lib/market";
import { cn } from "@/lib/utils";
import { normalizeNick } from "@/lib/confronto-sheet";
import { espnPlayerUrl } from "@/lib/links";

// Timeline semanal dos jogadores de um confronto (motor novo: app_confronto_projecao).
// Complemento do /confronto: não substitui nenhuma tabela existente. Se a RPC falhar
// (ex.: não logado), no modo embutido o componente some em silêncio.

export type Jogo = {
  event: string;
  date_et: string;
  starts_at: string;
  status: "scheduled" | "live" | "final" | "other";
  casa: boolean;
  adv: string;
  n: number;
  played: boolean;
  min: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
};
export type Jogador = { nome: string; time_nba: string | null; jogos: Jogo[] };
type TeamInfo = { id: string; name: string };
export type Fonte = "titular" | "reserva" | "reserva_provisorio" | "pendente" | "vazio" | "vazio_reserva_ja_usado";
export type Slot = {
  lado: "home" | "away";
  pos: string;
  ordem: number;
  fonte: Fonte;
  titular: string | null;
  reserva: string | null;
  usado: string | null;
  evento_usado: string | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tpm: number;
  tov: number;
};
type Cat = {
  category_key: string;
  home_value: number;
  away_value: number;
  winner: "home" | "away" | "tie" | null;
  home_score: number;
  away_score: number;
  tied: number;
  home_pending: number;
  away_pending: number;
  home_provisional: number;
  away_provisional: number;
};
export type Payload = {
  game: {
    id: string;
    week: number;
    starts_on: string;
    game_number: number;
    status: string;
    home_team: TeamInfo;
    away_team: TeamInfo;
  };
  sem_escalacao?: ("home" | "away")[];
  placar: Cat[];
  slots: Slot[];
  jogadores: Record<string, Jogador>;
};

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const CAT_LABEL: Record<string, string> = {
  pts: "PTS",
  reb: "REB",
  ast: "AST",
  stl: "STL",
  blk: "BLK",
  "3pm": "3PM",
  tpm: "3PM",
  to: "TO",
  tov: "TO",
};

export const FONTE_INFO: Record<Fonte, { texto: string; cls: string }> = {
  titular: { texto: "Titular", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  reserva: { texto: "Reserva confirmado", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  reserva_provisorio: { texto: "Reserva provisório", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  pendente: { texto: "Aguardando jogo", cls: "bg-slate-500/20 text-slate-800 dark:text-slate-100" },
  vazio: { texto: "Sem jogador", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  vazio_reserva_ja_usado: {
    texto: "Sem jogador (reserva já usado)",
    cls: "bg-red-500/15 text-red-700 dark:text-red-300",
  },
};

// Observação ao lado do nome de cada jogador, conforme o estado da vaga.
function observacao(fonte: Fonte, papel: "Titular" | "Reserva"): { texto: string; cls: string } | null {
  const amber = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  const sky = "bg-sky-500/15 text-sky-700 dark:text-sky-300";
  const red = "bg-red-500/15 text-red-700 dark:text-red-300";
  const mut = "bg-slate-500/20 text-slate-800 dark:text-slate-100";
  if (papel === "Titular") {
    if (fonte === "pendente") return { texto: "aguardando jogo", cls: mut };
    if (fonte === "reserva_provisorio") return { texto: "sem jogo até agora", cls: amber };
    if (fonte === "reserva") return { texto: "não alcança o jogo", cls: red };
    if (fonte === "vazio" || fonte === "vazio_reserva_ja_usado") return { texto: "sem jogo", cls: red };
    return null;
  }
  if (fonte === "reserva_provisorio") return { texto: "reserva provisório", cls: amber };
  if (fonte === "reserva") return { texto: "reserva confirmado", cls: sky };
  if (fonte === "vazio_reserva_ja_usado") return { texto: "já usado em outra vaga", cls: red };
  if (fonte === "vazio") return { texto: "sem jogo", cls: red };
  return null;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDia(iso: string) {
  return iso.slice(8, 10) + "/" + iso.slice(5, 7);
}
function horaBR(ts: string) {
  return new Date(ts).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export type ProjResult = { data: Payload | null; err: string | null; at: Date | null };

export function useProjecao(gameId: string, enabled = true): ProjResult {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const { data: d, error } = await callRpc("app_confronto_projecao", { _game_id: gameId });
    if (error || !d) {
      setErr(error?.message ?? "Confronto não encontrado.");
      return;
    }
    setErr(null);
    setData(d as Payload);
    setAt(new Date());
  }, [gameId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, enabled]);

  return { data, err, at };
}

export function TimelineSemana({
  gameId,
  proj,
  comPlacar = false,
  silencioso = true,
  espn,
}: {
  gameId: string;
  /** nome normalizado (normalizeNick) → espn_id; linka titulares e reservas à ESPN. */
  espn?: Record<string, string>;
  /** Dados já carregados pela página (evita buscar duas vezes). */
  proj?: ProjResult;
  /** Mostra também o placar projetado (usado na página /projecao). */
  comPlacar?: boolean;
  /** Em caso de erro (ex.: não logado) não mostra nada. */
  silencioso?: boolean;
}) {
  const own = useProjecao(gameId, !proj);
  const { data, err, at } = proj ?? own;

  if (err) return silencioso ? null : <p className="p-4 text-sm text-destructive">{err}</p>;
  if (!data) return silencioso ? null : <p className="p-4 text-sm text-muted-foreground">Carregando…</p>;

  const { game, placar, slots, jogadores } = data;
  const semEsc = data.sem_escalacao ?? [];

  return (
    <section className="mt-10">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl tracking-tight">Jogos da semana · timeline</h2>
        <span className="text-xs text-muted-foreground">
          Prévia · atualiza a cada 60 s{at ? ` · ${at.toLocaleTimeString("pt-BR")}` : ""}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Semana {game.week} · Jogo {game.game_number}. Veja quando cada jogador joga e, se o titular não entrar em
        quadra, qual reserva cobre a vaga (provisoriamente, até o titular alcançar o jogo).
      </p>

      {comPlacar && <PlacarProjetado placar={placar} home={game.home_team.name} away={game.away_team.name} />}

      {semEsc.length > 0 && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
          Sem escalação registrada no site para{" "}
          {semEsc.map((l) => (l === "home" ? game.home_team.name : game.away_team.name)).join(" e ")} neste jogo; o motor
          não consegue calcular esse lado (só confrontos até a semana 3 têm essa lacuna).
        </p>
      )}

      {(["home", "away"] as const).map((lado) =>
        slots.some((s) => s.lado === lado) ? (
        <Tabela
          key={lado}
          titulo={lado === "home" ? game.home_team.name : game.away_team.name}
          slots={slots.filter((s) => s.lado === lado)}
          jogadores={jogadores}
          inicio={game.starts_on}
          jogoLiga={game.game_number}
          espn={espn}
        />
        ) : null,
      )}

      <Glossario />
    </section>
  );
}

function PlacarProjetado({ placar, home, away }: { placar: Cat[]; home: string; away: string }) {
  const hs = placar[0]?.home_score ?? 0;
  const as = placar[0]?.away_score ?? 0;
  const pend = (lado: "home" | "away") =>
    Math.max(...placar.map((c) => (lado === "home" ? c.home_pending : c.away_pending)), 0);
  const prov = (lado: "home" | "away") =>
    Math.max(...placar.map((c) => (lado === "home" ? c.home_provisional : c.away_provisional)), 0);
  return (
    <div className="mb-6 rounded-lg border">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-4 py-4">
        <div className="text-right">
          <div className="font-medium">{home}</div>
          <div className="text-xs text-muted-foreground">
            {pend("home")} pendente(s) · {prov("home")} provisório(s)
          </div>
        </div>
        <div className="text-center font-display text-3xl tabular-nums">
          {hs} <span className="text-muted-foreground">×</span> {as}
        </div>
        <div>
          <div className="font-medium">{away}</div>
          <div className="text-xs text-muted-foreground">
            {pend("away")} pendente(s) · {prov("away")} provisório(s)
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {placar.map((c) => (
            <tr key={c.category_key} className="border-b last:border-b-0">
              <td className={cn("w-1/3 px-4 py-1.5 text-right tabular-nums", c.winner === "home" && "font-semibold text-[color:var(--court)]")}>
                {c.home_value}
              </td>
              <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                {CAT_LABEL[c.category_key] ?? c.category_key.toUpperCase()}
              </td>
              <td className={cn("w-1/3 px-4 py-1.5 tabular-nums", c.winner === "away" && "font-semibold text-[color:var(--court)]")}>
                {c.away_value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tabela({
  titulo,
  slots,
  jogadores,
  inicio,
  jogoLiga,
  espn,
}: {
  titulo: string;
  slots: Slot[];
  jogadores: Record<string, Jogador>;
  inicio: string;
  jogoLiga: number;
  espn?: Record<string, string>;
}) {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const extras = new Set<string>();
  for (const s of slots)
    for (const id of [s.titular, s.reserva]) {
      if (!id) continue;
      for (const j of jogadores[id]?.jogos ?? []) if (!dias.includes(j.date_et)) extras.add(j.date_et);
    }
  const cols = [...dias, ...[...extras].sort()];

  return (
    <div className="mb-8">
      <h3 className="mb-2 font-display text-lg tracking-tight">{titulo}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left font-semibold">Pos</th>
              <th className="px-2 py-2 text-left font-semibold">Jogador</th>
              {cols.map((d, i) => (
                <th key={d} className="px-1 py-2 text-center font-semibold">
                  {i < 7 ? DIAS[i] : "Extra"}
                  <div className="font-normal normal-case text-muted-foreground">{fmtDia(d)}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Vaga</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const info = FONTE_INFO[s.fonte];
              const linhas: { id: string | null; papel: "Titular" | "Reserva" }[] = [
                { id: s.titular, papel: "Titular" },
                { id: s.reserva, papel: "Reserva" },
              ];
              return linhas.map((l, idx) => {
                const p = l.id ? jogadores[l.id] : null;
                const usado = !!l.id && s.usado === l.id;
                const obs = observacao(s.fonte, l.papel);
                return (
                  <tr key={`${s.pos}-${idx}`} className={cn("border-t border-border/50", idx === 1 && "bg-muted/20")}>
                    <td className="px-2 py-1.5 align-top font-medium">{idx === 0 ? s.pos : ""}</td>
                    <td className="px-2 py-1.5">
                      <div className={cn("whitespace-nowrap", usado && "font-semibold")}>
                        {p && espn?.[normalizeNick(p.nome)] ? (
                          <a
                            href={espnPlayerUrl(espn[normalizeNick(p.nome)])}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ver na ESPN"
                            className="hover:text-[color:var(--court)] hover:underline"
                          >
                            {p.nome}
                          </a>
                        ) : (
                          (p?.nome ?? "—")
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <span>
                          {l.papel}
                          {p?.time_nba ? ` · ${p.time_nba}` : ""}
                        </span>
                        {obs && p && <span className={cn("rounded px-1 py-0.5", obs.cls)}>{obs.texto}</span>}
                      </div>
                    </td>
                    {cols.map((d) => {
                      const j = p?.jogos.find((x) => x.date_et === d);
                      const conta =
                        !!j &&
                        ((idx === 0 && s.fonte === "titular" && j.n === jogoLiga) ||
                          (usado && s.evento_usado === j.event));
                      return <Celula key={d} j={j} conta={!!conta} />;
                    })}
                    <td className="px-2 py-1.5 text-right align-top">
                      {idx === 0 && (
                        <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px]", info.cls)}>
                          {info.texto}
                        </span>
                      )}
                      {idx === 0 && s.fonte !== "pendente" && s.fonte !== "vazio" && (
                        <div className="mt-1 tabular-nums text-muted-foreground">
                          {s.pts}/{s.reb}/{s.ast}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Celula({ j, conta }: { j?: Jogo; conta: boolean }) {
  if (!j) return <td className="px-1 py-1.5 text-center text-muted-foreground/50">–</td>;
  const adv = `${j.casa ? "vs" : "@"} ${j.adv}`;
  let corpo: React.ReactNode;
  let cls = "";
  if (j.status === "final") {
    if (j.played) {
      corpo = (
        <>
          <div>✔ {adv}</div>
          <div className="tabular-nums">
            {j.pts}/{j.reb}/{j.ast}
          </div>
        </>
      );
      cls = "bg-emerald-500/10";
    } else {
      corpo = (
        <>
          <div>{adv}</div>
          <div className="font-medium text-red-600 dark:text-red-400">✖ DNP</div>
        </>
      );
      cls = "bg-red-500/10";
    }
  } else if (j.status === "live") {
    corpo = (
      <>
        <div>{adv}</div>
        <div className="font-medium text-amber-600 dark:text-amber-400">● ao vivo</div>
        {j.played && (
          <div className="tabular-nums">
            {j.pts}/{j.reb}/{j.ast}
          </div>
        )}
      </>
    );
    cls = "bg-amber-500/10";
  } else {
    corpo = (
      <>
        <div>{adv}</div>
        <div className="text-muted-foreground">{horaBR(j.starts_at)}</div>
      </>
    );
  }
  return (
    <td className="px-1 py-1 text-center align-top">
      <div className={cn("rounded px-1 py-1 leading-tight", cls, conta && "ring-2 ring-[color:var(--court-bright)]")}>
        {corpo}
      </div>
    </td>
  );
}


// ─── Integração com o box score do /confronto ─────────────────────────────────

export type LinhaInfo = {
  chip: { texto: string; cls: string };
  detalhe: string | null;
  /** pts, reb, ast, stl, blk, 3pm, to que o motor atribui à vaga (reserva cobrindo), quando diferem da planilha */
  subst: number[] | null;
  /** subst − o que a planilha já soma nessa linha (nulo = 0): é o que entra no total "com provisórios" */
  delta: number[] | null;
};

/** Linha do box score da planilha (só o que o motor precisa para comparar). */
export type LinhaPlanilha = {
  name: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  three_pm: number | null;
  turnovers: number | null;
};

function fmtProx(j: Jogo) {
  const dia = new Date(j.starts_at).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" });
  return `${dia.replace(".", "")} ${horaBR(j.starts_at)} ${j.casa ? "vs" : "@"} ${j.adv}`;
}
function proximoJogo(p: Jogador | undefined | null): string | null {
  const j = p?.jogos.find((x) => x.status !== "final");
  return j ? fmtProx(j) : null;
}

/**
 * Casa cada linha do box score (vindo da planilha) com a vaga do motor, pelo nome
 * (titular, usado ou reserva). Linha sem correspondência fica sem status.
 */
export function resolverLinhas(
  proj: Payload | null,
  lado: "home" | "away",
  linhas: LinhaPlanilha[],
  norm: (s: string) => string,
): (LinhaInfo | null)[] {
  if (!proj) return linhas.map(() => null);
  const slots = proj.slots.filter((s) => s.lado === lado);
  const usadoIdx = new Set<number>();
  const nome = (id: string | null) => (id ? proj.jogadores[id]?.nome ?? null : null);
  return linhas.map((l) => {
    if (!l.name) return null;
    const n = norm(l.name);
    let k = slots.findIndex((s, i) => !usadoIdx.has(i) && nome(s.titular) && norm(nome(s.titular)!) === n);
    if (k < 0)
      k = slots.findIndex((s, i) => !usadoIdx.has(i) && nome(s.usado) && norm(nome(s.usado)!) === n);
    if (k < 0)
      k = slots.findIndex((s, i) => !usadoIdx.has(i) && nome(s.reserva) && norm(nome(s.reserva)!) === n);
    if (k < 0) return null;
    usadoIdx.add(k);
    const s = slots[k];
    const info = FONTE_INFO[s.fonte];
    const tit = s.titular ? proj.jogadores[s.titular] : null;
    const cobre = !!s.usado && s.usado !== s.titular && (s.fonte === "reserva_provisorio" || s.fonte === "reserva");
    let detalhe: string | null = null;
    if (s.fonte === "reserva_provisorio") {
      const prox = proximoJogo(tit);
      detalhe = `${nome(s.usado) ?? "reserva"} cobre${prox ? ` · titular joga ${prox}` : ""}`;
    } else if (s.fonte === "reserva") {
      detalhe = `${nome(s.usado) ?? "reserva"} cobre (definitivo)`;
    } else if (s.fonte === "pendente") {
      const prox = proximoJogo(tit);
      detalhe = prox ? `próx.: ${prox}` : null;
    }
    // O motor manda na vaga quando um reserva cobre: se a linha da planilha está vazia ou mostra
    // outro jogador (ex.: o titular que o motor já usou em outra vaga), valem os números do motor
    // e só a diferença contra a planilha entra no total — senão o mesmo jogo contaria duas vezes.
    const usadoNome = nome(s.usado);
    const motorManda = cobre && (l.pts === null || (!!usadoNome && norm(usadoNome) !== n));
    const subst = motorManda ? [s.pts, s.reb, s.ast, s.stl, s.blk, s.tpm, s.tov] : null;
    const planilha = [l.pts, l.reb, l.ast, l.stl, l.blk, l.three_pm, l.turnovers];
    const delta = subst ? subst.map((v, c) => v - (planilha[c] ?? 0)) : null;
    return { chip: { texto: info.texto, cls: info.cls }, detalhe, subst, delta };
  });
}

// ─── Glossário ──────────────────────────────────────────────────────────────────

function Glossario() {
  const vaga: [Fonte, string][] = [
    ["titular", "O titular da posição está contando: ele já jogou o jogo da NBA que vale para este jogo da liga."],
    [
      "pendente",
      "Ninguém contou ainda: o titular ainda pode jogar o jogo que lhe cabe. Até acontecer, a vaga soma zero no placar.",
    ],
    [
      "reserva_provisorio",
      "O titular já perdeu pelo menos um jogo do time na semana, mas ainda pode alcançar o jogo que vale. Por ora conta o reserva da mesma posição; se o titular jogar, a vaga volta para ele.",
    ],
    [
      "reserva",
      "O titular não consegue mais chegar ao jogo que vale (os jogos restantes do time não bastam). O reserva da mesma posição conta e não muda mais.",
    ],
    ["vazio", "Nem o titular nem o reserva têm jogo que valha: a vaga fica sem jogador e soma zero."],
    [
      "vazio_reserva_ja_usado",
      "O reserva até teria jogo, mas já foi usado em outra vaga neste jogo da liga; o mesmo jogador não conta duas vezes.",
    ],
  ];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 font-display text-lg tracking-tight">Glossário</h3>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estado da vaga</p>
      <dl className="mb-4 grid gap-2 text-sm">
        {vaga.map(([k, txt]) => (
          <div key={k} className="grid grid-cols-[170px_1fr] items-start gap-3">
            <dt>
              <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px]", FONTE_INFO[k].cls)}>
                {FONTE_INFO[k].texto}
              </span>
            </dt>
            <dd className="text-muted-foreground">{txt}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Na timeline</p>
      <dl className="grid gap-2 text-sm">
        {(
          [
            ["✔ vs/@ XXX · 17/5/3", "Jogou. Os números são PTS/REB/AST. “vs” = em casa, “@” = fora."],
            ["✖ DNP", "O jogo terminou e o jogador não entrou em quadra (não conta nada)."],
            ["● ao vivo", "Jogo em andamento; os números mudam até o fim."],
            ["19:30", "Horário (Brasília) do jogo que ainda vai acontecer."],
            ["–", "O time do jogador não joga nesse dia."],
            ["Célula com borda", "É o jogo da NBA que vale para este confronto."],
            ["Extra", "Jogo fora de segunda–domingo, “emprestado” de outra semana porque o time tem menos jogos que a liga."],
            ["sem jogo até agora", "Observação no titular: ele já perdeu jogo(s) do time na semana."],
            ["não alcança o jogo", "Observação no titular: não há mais jogos suficientes para ele; o reserva é definitivo."],
            ["reserva provisório / confirmado", "Observação no reserva: está cobrindo a vaga; provisório pode voltar ao titular."],
          ] as [string, string][]
        ).map(([k, txt]) => (
          <div key={k} className="grid grid-cols-[170px_1fr] items-start gap-3">
            <dt className="text-xs font-medium">{k}</dt>
            <dd className="text-muted-foreground">{txt}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Dados: ESPN (provisório, durante os jogos) e NBA oficial (definitivo, conferido no dia seguinte). Regra geral: o
        k-ésimo jogo da NBA de cada titular vale para o k-ésimo jogo da liga na semana; o reserva só cobre a mesma posição.
      </p>
    </div>
  );
}
