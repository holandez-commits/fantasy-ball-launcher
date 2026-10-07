-- ============================================================================
-- FIX: team_cap_usage casava salario por season_label DERIVADO como '2026-27',
-- mas o dado vivo em roster_contract_years.season_label e '26/27' (= seasons.label).
-- Resultado do bug: o join nao casava nada -> salaries=0 -> cap ~cheio pra todos.
--
-- Correcao: usar seasons.label direto (sem derivar). Resto IDENTICO (cap 70M fixo,
-- multas por season_id, IR fora, so times ativos). Assinatura igual -> CREATE OR
-- REPLACE basta. Rodar no SQL Editor e arquivar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.team_cap_usage(_season_id uuid)
 RETURNS TABLE(team_id uuid, salaries bigint, penalties bigint, used bigint, available bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with s as (
    select start_year as yr, label as season_label
    from seasons
    where id = _season_id
  ),
  sal as (
    select re.team_id, coalesce(sum(cy.salary),0)::bigint as salaries
    from roster_entries re
    join roster_contract_years cy
      on cy.roster_entry_id = re.id
     and cy.season_label = (select season_label from s)   -- << usa seasons.label ('26/27')
    where re.season = (select yr from s)
      and re.status <> 'injured_reserve'
    group by re.team_id
  ),
  pen as (
    select tp.team_id, coalesce(sum(tp.amount),0)::bigint as penalties
    from team_penalties tp
    where tp.season_id = _season_id
    group by tp.team_id
  )
  select t.id,
         coalesce(sal.salaries,0)::bigint,
         coalesce(pen.penalties,0)::bigint,
         (coalesce(sal.salaries,0) + coalesce(pen.penalties,0))::bigint,
         (70000000 - coalesce(sal.salaries,0) - coalesce(pen.penalties,0))::bigint
  from teams t
  left join sal on sal.team_id = t.id
  left join pen on pen.team_id = t.id
  where t.is_active;
$function$;


-- ─── VERIFICAÇÃO (rodar depois do CREATE; não altera nada) ───────────────────
-- 1) Balboas na 26/27 deve bater com a página /times:
--    salaries ~44,4M, penalties 1,4M, available ~24,2M (CAP DISPONÍVEL 26/27 da tela).
-- select t.name, c.*
-- from team_cap_usage((select id from seasons where start_year = 2026)) c
-- join teams t on t.id = c.team_id
-- where t.slug = 'santo-andre-balboas';
--
-- 2) Sanidade: nenhum time ativo deve estourar o cap na 26/27 (available < 0).
--    Antes do fix isso "passava" falsamente (salaries sempre 0). Agora e real.
-- select t.name, c.available
-- from team_cap_usage((select id from seasons where start_year = 2026)) c
-- join teams t on t.id = c.team_id
-- where c.available < 0
-- order by c.available;
