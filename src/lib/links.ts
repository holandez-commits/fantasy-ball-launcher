/**
 * Links externos usados em mais de uma tela.
 * Ponto único para trocar o domínio/formato da ESPN.
 */
export function espnPlayerUrl(espnId: string): string {
  return `https://www.espn.com/nba/jogador/_/id/${espnId}`;
}
