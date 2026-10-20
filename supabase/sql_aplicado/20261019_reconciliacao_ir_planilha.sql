-- 20261019 — Reconciliação de IR 26/27 a partir da planilha de elencos.
-- Na planilha 'BOLA PRESA - Elencos.xlsx' o IR é marcado pela COR DA FONTE VERMELHA
-- (rgb FFFF0000) no nome do jogador. O importador de elencos NÃO captura cor, então
-- esses jogadores entraram como 'active', estourando as 15 vagas de 4 times (que ficaram
-- com 16 ativos) e barrando trocas 1-por-1. Aqui marcamos os 7 como injured_reserve
-- (ir_since_season=2026 → só retornam em 27/28). O motor já exclui IR das 15 vagas.
-- (Brasília Carcarás / Henri Veesaar já estava em IR — o importador pegou esse.)
-- Rodado via MCP no PROD (sessão 11).
update public.roster_entries re
   set status='injured_reserve', ir_since_season=2026, updated_at=now()
  from public.teams t, public.players p
 where re.team_id=t.id and re.player_id=p.id and re.season=2026
   and (t.name, p.full_name) in (
     ('João Pessoa Fats','Brandon Ingram'),
     ('Cambuquira Pure Water','Shaedon Sharpe'),
     ('Dengue State Outlawz','Jusuf Nurkić'),
     ('Campos Lighthalzen','Moses Moody'),
     ('Pinheiros Racecars','Mark Williams'),
     ('Santo André Balboas','Otega Oweh'),
     ('Rio Preto Capivaras','Donte DiVincenzo')
   );
