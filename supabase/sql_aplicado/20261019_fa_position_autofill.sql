-- 20261019_fa_position_autofill.sql
-- RODAR NO SQL EDITOR do Supabase (o MCP bloqueia o 'drop table' da temp table interna).
--
-- FA contratado via leilão herda a ÚLTIMA posição conhecida do jogador (roster_entry mais
-- recente com posição). Sem histórico -> NULL, e o admin resolve no painel "Contratações sem
-- posição" (RPC set_signing_position, que já existe em /admin/mercado).
-- Única mudança vs. a versão em produção: a posição no insert do roster_entry (antes era NULL fixo).

create or replace function public.leilao_commit(_season_id uuid, _week integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start_year integer;
  v_label      text;
  v_w          record;
  v_tx         uuid;
  v_re         uuid;
  v_signed     integer := 0;
  v_lost       integer := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin consolida o leilão.';
  end if;

  select start_year, label into v_start_year, v_label from public.seasons where id = _season_id;

  -- vencedores da cascata (snapshot em memória)
  drop table if exists _winners;
  create temp table _winners on commit drop as
    select * from public.leilao_resolver(_season_id, _week);

  for v_w in select * from _winners loop
    -- 1 signing por vencedor, já executado
    insert into public.transactions (type, status, season_id, week_number, proposed_by, executed_at)
    values ('signing', 'executed', _season_id, _week, null, now())
    returning id into v_tx;

    -- cria o vínculo (contrato de 1 temporada ao salário do lance).
    -- Posição = última conhecida do jogador (se houver); senão NULL (admin ajusta no painel).
    insert into public.roster_entries (team_id, player_id, season, status, position, acquired_via)
    values (
      v_w.team_id, v_w.player_id, v_start_year, 'active',
      (select re2.position
         from public.roster_entries re2
        where re2.player_id = v_w.player_id
          and re2.position is not null
        order by re2.season desc
        limit 1),
      'signing')
    returning id into v_re;

    insert into public.roster_contract_years (roster_entry_id, season_label, salary)
    values (v_re, v_label, v_w.salary_offer);

    -- ledger: item do jogador contratado (vem da free agency -> from_team null)
    insert into public.transaction_items (transaction_id, asset_type, player_id, to_team_id, amount)
    values (v_tx, 'player', v_w.player_id, v_w.team_id, v_w.salary_offer);

    -- marca o lance vencedor
    update public.free_agent_bids
       set status = 'won'
     where season_id = _season_id and week_number = _week
       and player_id = v_w.player_id and team_id = v_w.team_id and status = 'active';

    v_signed := v_signed + 1;
  end loop;

  -- todos os demais lances ativos da semana viram 'lost'
  update public.free_agent_bids
     set status = 'lost'
   where season_id = _season_id and week_number = _week and status = 'active';
  get diagnostics v_lost = row_count;

  return format('Leilão consolidado: %s contratação(ões), %s lance(s) perdedor(es).', v_signed, v_lost);
end;
$function$;
