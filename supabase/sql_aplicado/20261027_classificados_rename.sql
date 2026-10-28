-- 27/10/2026 — Renomeação visível: "Trade block" -> "Classificados Bola Presa" (rota /classificados). Aplicado em PROD via MCP.
-- Tabelas/RPCs/categoria 'bloco' mantêm os nomes internos (trade_block_*, 'bloco').
-- 1) publicar_trade_block: título do aviso passa a "<time> anunciou nos Classificados Bola Presa" e link '/classificados'
--    (aplicado trocando os trechos na definição via pg_get_functiondef + execute).
-- 2) Avisos já gravados: link '/trade-block' -> '/classificados' e título ajustado (0 linhas na hora).
-- No site, /trade-block redireciona para /classificados.
do $t$
declare d text;
begin
  d := replace(pg_get_functiondef('public.publicar_trade_block(uuid[],uuid[],text)'::regprocedure), E'\r', '');
  if position(' abriu o trade block' in d) = 0 or position('''/trade-block''' in d) = 0 then
    raise exception 'trecho não encontrado';
  end if;
  d := replace(d, ' abriu o trade block', ' anunciou nos Classificados Bola Presa');
  d := replace(d, '''/trade-block''', '''/classificados''');
  execute d;
end $t$;
update public.notifications set link = '/classificados' where link = '/trade-block';
update public.notifications set title = replace(title, ' abriu o trade block', ' anunciou nos Classificados Bola Presa') where kind = 'trade_block_post';
