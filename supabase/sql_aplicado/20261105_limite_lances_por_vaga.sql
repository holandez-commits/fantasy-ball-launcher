-- 20261105_limite_lances_por_vaga.sql
--
-- Regra do leilão de FA: cada time só pode ter, na semana, tantos lances ATIVOS quantas
-- forem as suas vagas livres (15 - jogadores ativos, IR não conta).
--   15 ativos = 0 lances | 14 = 1 | 13 = 2 | ...
-- Retirar um lance libera a vaga pra outro. Atualizar um lance existente não consome vaga extra.
--
-- Mudanças:
--   1) dar_lance: bloqueia o lance quando lances ativos (de outros jogadores) >= vagas livres.
--      dar_lance_novo passa pela mesma validação (chama dar_lance).
--   2) lances_disponiveis(_week): devolve {vagas_livres, lances_ativos, restantes} pra tela.
-- leilao_resolver não muda (a checagem de vaga dele vira só uma rede de segurança).
-- Reversão: reaplicar a definição anterior de dar_lance e `drop function public.lances_disponiveis(integer);`

create or replace function public.lances_disponiveis(_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_team   uuid := public.current_team_id();
  v_season uuid; v_start int;
  v_slots  int; v_used int;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;
  select id, start_year into v_season, v_start from public.seasons where is_current = true;

  v_slots := greatest(0, 15 - (select count(*) from public.roster_entries re
                               where re.team_id = v_team and re.season = v_start
                                 and re.status <> 'injured_reserve'));
  v_used := (select count(*) from public.free_agent_bids b
             where b.team_id = v_team and b.season_id = v_season
               and b.week_number = _week and b.status = 'active');

  return jsonb_build_object(
    'vagas_livres', v_slots,
    'lances_ativos', v_used,
    'restantes', greatest(0, v_slots - v_used)
  );
end;
$function$;

revoke all on function public.lances_disponiveis(integer) from public, anon;
grant execute on function public.lances_disponiveis(integer) to authenticated;

create or replace function public.dar_lance(_player_id uuid, _salary_offer bigint, _week integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gm        uuid := public.current_gm_id();
  v_team      uuid := public.current_team_id();
  v_season_id uuid;
  v_start     integer;
  v_open      boolean;
  v_avail     bigint;
  v_bid       uuid;
  v_slots     integer;
  v_used      integer;
begin
  if v_team is null then
    raise exception 'Você não tem um time ativo (não é GM?).';
  end if;

  select id, start_year into v_season_id, v_start from public.seasons where is_current = true;

  -- gate: lances só com o mercado FECHADO
  select is_open into v_open from public.market_state where season_id = v_season_id;
  if coalesce(v_open, false) then
    raise exception 'Mercado aberto — lances de free agent estão fechados agora.';
  end if;

  if _salary_offer < 750000 then
    raise exception 'Lance mínimo é 750.000.';
  end if;

  if not exists (select 1 from public.players where id = _player_id) then
    raise exception 'Jogador % inexistente.', _player_id;
  end if;

  -- pool = free agents AO VIVO: o jogador não pode estar em nenhum elenco da temporada
  if exists (select 1 from public.roster_entries re
             join public.seasons s on s.start_year = re.season
             where s.id = v_season_id and re.player_id = _player_id) then
    raise exception 'Jogador está em elenco nesta temporada (não é free agent).';
  end if;

  -- cap: o lance único tem que caber no seu cap disponível atual
  select available into v_avail from public.team_cap_usage(v_season_id) where team_id = v_team;
  if _salary_offer > coalesce(v_avail, 0) then
    raise exception 'Lance % acima do seu cap disponível (%).', _salary_offer, coalesce(v_avail, 0);
  end if;

  -- limite de lances = vagas livres. Trava por time pra dois lances simultâneos não furarem o limite.
  perform pg_advisory_xact_lock(hashtextextended('lance:' || v_team::text, 0));

  v_slots := greatest(0, 15 - (select count(*) from public.roster_entries re
                               where re.team_id = v_team and re.season = v_start
                                 and re.status <> 'injured_reserve'));
  -- lances ativos em OUTROS jogadores (atualizar o lance do mesmo jogador não consome vaga)
  v_used := (select count(*) from public.free_agent_bids b
             where b.team_id = v_team and b.season_id = v_season_id
               and b.week_number = _week and b.status = 'active'
               and b.player_id <> _player_id);
  if v_used >= v_slots then
    if v_slots = 0 then
      raise exception 'Seu time está com 15 jogadores ativos: sem vaga, sem lances disponíveis.';
    end if;
    raise exception 'Limite de lances atingido: seu time tem % vaga(s) livre(s) e já tem % lance(s) ativo(s). Retire um lance para dar outro.', v_slots, v_used;
  end if;

  -- upsert: 1 lance por (season,week,player,team). Editar mantém o created_at.
  select id into v_bid from public.free_agent_bids
  where season_id = v_season_id and week_number = _week and player_id = _player_id and team_id = v_team;

  if v_bid is not null then
    update public.free_agent_bids
       set salary_offer = _salary_offer, status = 'active', gm_id = v_gm
     where id = v_bid;
  else
    insert into public.free_agent_bids (season_id, week_number, player_id, team_id, gm_id, salary_offer)
    values (v_season_id, _week, _player_id, v_team, v_gm, _salary_offer)
    returning id into v_bid;
  end if;

  return v_bid;
end;
$function$;
