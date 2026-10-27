-- 26/10/2026 — Regra da liga: fatia mínima de multa em PROPOR TROCA = 50.000 (era 250.000).
-- executar_dispensa NÃO muda. Aplicado em PROD via MCP (replace sobre a definição viva de propor_troca).
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='propor_troca';
  if position('v_amt < 250000' in d) = 0 then raise exception 'padrao nao encontrado'; end if;
  d := replace(d, 'v_amt < 250000', 'v_amt < 50000');
  d := replace(d, 'mínima é 250.000', 'mínima é 50.000');
  execute d;
end $$;
