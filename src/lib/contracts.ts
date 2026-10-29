import { db, fetchCurrentSeason, fmtMoney, fmtMoneyShort, type CurrentSeason } from "@/lib/market";

export type ContractInfo = { salary: number; years: number };

/** "1 ano" | "3 anos (este, mais 2)" */
export function fmtYearsLeft(years: number): string {
  if (!years || years <= 0) return "";
  if (years === 1) return "1 ano";
  return `${years} anos (este, mais ${years - 1})`;
}

/** "$11.5M · 3 anos (este, mais 2)" — só o salário da temporada atual. */
export function fmtContract(c: ContractInfo | null | undefined, full = false): string {
  if (!c || !c.salary) return "";
  const money = full ? fmtMoney(c.salary) : fmtMoneyShort(c.salary);
  const yrs = fmtYearsLeft(c.years);
  return yrs ? `${money} · ${yrs}` : money;
}

/** Contrato a partir da lista por ano: salário do ano atual (1º da lista) e quantos anos restam. */
export function contractFromYears(
  list: { season_label: string; salary: number }[] | null | undefined,
  currentLabel?: string,
): ContractInfo | null {
  if (!list || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.season_label.localeCompare(b.season_label));
  const from = currentLabel ? sorted.filter((c) => c.season_label >= currentLabel) : sorted;
  if (from.length === 0) return null;
  return { salary: from[0].salary, years: from.length };
}

/** Busca contrato (temporada atual + anos restantes) de vários jogadores de uma vez. */
export async function fetchContractMap(
  playerIds: string[],
  season?: CurrentSeason | null,
): Promise<Map<string, ContractInfo>> {
  const out = new Map<string, ContractInfo>();
  const ids = [...new Set(playerIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const cur = season ?? (await fetchCurrentSeason());
  if (!cur) return out;
  const reRes = await db
    .from("roster_entries")
    .select("id, player_id")
    .eq("season", cur.start_year)
    .in("player_id", ids);
  const entries = (reRes.data ?? []) as { id: string; player_id: string }[];
  if (entries.length === 0) return out;
  const cyRes = await db
    .from("roster_contract_years")
    .select("roster_entry_id, season_label, salary")
    .in("roster_entry_id", entries.map((e) => e.id));
  const cy = (cyRes.data ?? []) as { roster_entry_id: string; season_label: string; salary: number }[];
  for (const e of entries) {
    const info = contractFromYears(
      cy.filter((c) => c.roster_entry_id === e.id),
      cur.label,
    );
    if (info) out.set(e.player_id, info);
  }
  return out;
}
