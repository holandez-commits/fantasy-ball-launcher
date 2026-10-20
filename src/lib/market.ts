// Helpers compartilhados das telas do mercado (dispensa, troca, leilão, IR).
// Mantém o padrão do escalar.tsx / admin.fechar-semana.tsx: acesso "frouxo" ao
// banco porque o types.ts é gerado do PROD — traz as TABELAS do mercado, mas não
// as RPCs do motor (que, por ora, só vivem no staging).

import { supabase } from "@/integrations/supabase/client";

// Acesso a tabelas sem a fricção dos tipos gerados (algumas colunas/relacionamentos
// do mercado o editor ainda não conhece conforme o ambiente).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (table: string) => any };

// Chamada de RPC frouxa (igual admin.fechar-semana.tsx), agora com args.
export const callRpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);

// ─── Dinheiro ───────────────────────────────────────────────────────────────

/** Valor cheio: $1.350.000 -> "$1,350,000". */
export function fmtMoney(v: number | null | undefined): string {
  if (!v || v === 0) return "$0";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** Abreviado pra espaços apertados: 1_350_000 -> "$1.4M". */
export function fmtMoneyShort(v: number | null | undefined): string {
  if (!v) return "—";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${(v / 1_000).toFixed(0)}K`;
}

// ─── Multa de dispensa (PRÉVIA no cliente) ───────────────────────────────────
// Espelha public.multa_pct do banco. É só estimativa pra UI; o valor que vale é
// o calculado no executar_dispensa (server-side), por ano restante, 50K de passo.

export function multaPct(salary: number): number {
  if (salary <= 2_000_000) return 0;
  if (salary <= 5_000_000) return 0.1; // 5M exatos = 10% (ao pé da tabela)
  if (salary <= 7_000_000) return 0.15;
  if (salary <= 10_000_000) return 0.2;
  return 0.25;
}

/** Multa de UM ano do contrato, arredondada a 50K (igual ao banco). */
export function multaDoAno(salary: number): number {
  const pct = multaPct(salary);
  if (pct <= 0) return 0;
  return Math.round((salary * pct) / 50_000) * 50_000;
}

export type ContractYear = { season_label: string; salary: number };

/** Prévia da multa total de uma dispensa, com a quebra por ano (só anos > 0). */
export function previaMulta(years: ContractYear[]): {
  porAno: { label: string; amount: number }[];
  total: number;
  anos: number;
  /** valor por ano quando é igual em todos os anos; null se varia (ou sem multa). */
  anoUniforme: number | null;
} {
  const porAno = (years ?? [])
    .map((y) => ({ label: y.season_label, amount: multaDoAno(y.salary) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  const total = porAno.reduce((acc, x) => acc + x.amount, 0);
  const anos = porAno.length;
  const anoUniforme =
    anos > 0 && porAno.every((p) => p.amount === porAno[0].amount) ? porAno[0].amount : null;
  return { porAno, total, anos, anoUniforme };
}

/** Resumo compacto da multa pra uma coluna/linha só (ex. tela admin). */
export function fmtMultaResumo(prv: {
  anos: number;
  anoUniforme: number | null;
  total: number;
}): string {
  if (prv.anos === 0) return "sem multa";
  if (prv.anoUniforme != null)
    return `${fmtMoney(prv.anoUniforme)}/ano × ${prv.anos} ${prv.anos > 1 ? "anos" : "ano"}`;
  return `varia (total ${fmtMoney(prv.total)})`;
}

// ─── Rótulos de transação ────────────────────────────────────────────────────

export const TX_TYPE_LABEL: Record<string, string> = {
  release: "Dispensa",
  trade: "Troca",
  signing: "Contratação",
  ir: "IR",
};

export const TX_STATUS_LABEL: Record<string, string> = {
  proposed: "Pendente",
  accepted: "Aceita",
  approved: "Aprovada",
  rejected: "Recusada",
  cancelled: "Cancelada",
  executed: "Executada",
  failed: "Falhou",
};

/** Classe de cor (tokens do tema) por status, pra badges. */
export function statusTone(status: string): string {
  switch (status) {
    case "executed":
      return "text-emerald-600 dark:text-emerald-400";
    case "approved":
    case "accepted":
      return "text-sky-600 dark:text-sky-400";
    case "proposed":
      return "text-amber-600 dark:text-amber-400";
    case "rejected":
    case "cancelled":
    case "failed":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

// ─── Trocas: agrupar por direção (quem envia pra quem) ───────────────────────

export type TradeAsset = { label: string; fromName: string; toName: string };

/** Agrupa os ativos de uma troca em blocos "X envia para Y". Preserva a ordem. */
export function groupTradeByDirection(
  items: TradeAsset[],
): { from: string; to: string; labels: string[] }[] {
  const groups: { from: string; to: string; labels: string[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.from === it.fromName && x.to === it.toName);
    if (!g) {
      g = { from: it.fromName, to: it.toName, labels: [] };
      groups.push(g);
    }
    g.labels.push(it.label);
  }
  return groups;
}

/** Data + hora curtas pt-BR (ex. "19/10 21:30"). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Temporada corrente + estado do mercado ──────────────────────────────────

export type CurrentSeason = { id: string; start_year: number; label: string };

export async function fetchCurrentSeason(): Promise<CurrentSeason | null> {
  const { data, error } = await db
    .from("seasons")
    .select("id, start_year, label")
    .eq("is_current", true)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as CurrentSeason;
}

/** Estado do mercado da temporada. null = sem linha em market_state. */
export async function fetchMarketOpen(seasonId: string): Promise<boolean | null> {
  const { data, error } = await db
    .from("market_state")
    .select("is_open")
    .eq("season_id", seasonId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return !!data[0].is_open;
}
