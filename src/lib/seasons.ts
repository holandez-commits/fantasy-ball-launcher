import { supabase } from "../integrations/supabase/client";

/**
 * Temporada padrão das páginas de ESTATÍSTICA: a mais recente que tenha ao menos
 * um jogo com status='final'. Recebe as temporadas ordenadas da mais nova para a
 * mais antiga. Se nenhuma tiver jogo final, cai para a is_current (ou a primeira).
 *
 * `games.status` existe no banco mas não em types.ts (desatualizado), por isso o
 * cast local na coluna.
 */
export async function pickDefaultStatsSeason<T extends { id: string; is_current: boolean }>(
  seasonsNewestFirst: T[],
): Promise<T | undefined> {
  for (const s of seasonsNewestFirst) {
    const { data } = await supabase
      .from("games")
      .select("id")
      .eq("season_id", s.id)
      .eq("status" as "id", "final")
      .limit(1);
    if (data && data.length > 0) return s;
  }
  return seasonsNewestFirst.find((s) => s.is_current) ?? seasonsNewestFirst[0];
}
