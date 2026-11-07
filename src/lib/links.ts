/**
 * Links externos usados em mais de uma tela.
 * Ponto único para trocar o domínio/formato da ESPN.
 */
export function espnPlayerUrl(espnId: string): string {
  return `https://www.espn.com/nba/jogador/_/id/${espnId}`;
}

/** Busca na ESPN pelo nome — usado enquanto o jogador não tem `espn_id` no banco. */
export function espnSearchUrl(name: string): string {
  return `https://www.espn.com/search/_/q/${encodeURIComponent(name)}`;
}
