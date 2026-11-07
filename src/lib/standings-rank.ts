/**
 * Campanha (V-D-E) e posição na conferência de um time.
 * Mesma regra da tabela de classificação: vitórias desc, empates desc, nome.
 * Só times ativos entram no ranking. Sem nenhum jogo final na conferência, a ordem seria
 * apenas alfabética, então a posição não é informada.
 */
export type StandRow = {
  team_id: string;
  w: number | string;
  d: number | string;
  l: number | string;
  gp: number | string;
};

export type ConfTeam = { id: string; name: string; conference: string | null };

export type Standing = { w: number; l: number; d: number; rank: number | null };

export function standingFor(teamId: string, activeTeams: ConfTeam[], rows: StandRow[]): Standing {
  const rec = new Map<string, { w: number; d: number; l: number; gp: number }>();
  for (const r of rows) {
    rec.set(r.team_id, { w: Number(r.w), d: Number(r.d), l: Number(r.l), gp: Number(r.gp) });
  }
  const get = (id: string) => rec.get(id) ?? { w: 0, d: 0, l: 0, gp: 0 };

  const me = activeTeams.find((t) => t.id === teamId);
  const r = get(teamId);
  let rank: number | null = null;
  if (me?.conference) {
    const conf = activeTeams
      .filter((t) => t.conference === me.conference)
      .sort((a, b) => {
        const A = get(a.id);
        const B = get(b.id);
        if (B.w !== A.w) return B.w - A.w;
        if (B.d !== A.d) return B.d - A.d;
        return a.name.localeCompare(b.name);
      });
    if (conf.some((t) => get(t.id).gp > 0)) rank = conf.findIndex((t) => t.id === teamId) + 1;
  }
  return { w: r.w, l: r.l, d: r.d, rank };
}
