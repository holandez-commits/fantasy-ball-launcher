-- 27/10/2026 — Item G: lance em jogador que nunca esteve na liga. Aplicado em PROD via MCP (DDL; funções + patches; testes em rollback).
-- Desenho: o nome digitado vira um jogador PENDENTE em players (is_pending) no momento do lance — assim lances de times
-- diferentes no mesmo nome disputam o mesmo jogador e o motor (dar_lance, leilao_resolver) não muda.
--   * players.is_pending / pending_position (posição definida pelo ADMIN antes de consolidar).
--   * dar_lance_novo(_name,_salary_offer,_week): valida nome, reaproveita jogador existente pelo nome sem acento/caixa
--     (recusa se já está em elenco), limite de 5 jogadores novos/semana por time, e chama dar_lance.
--   * set_novo_jogador(_player_id,_full_name,_position,_espn_id): admin ajusta nome/posição/ESPN do pendente.
--   * leilao_commit: BLOQUEIA se vencedor novo sem posição; vencedor novo vira jogador oficial (is_pending=false) e o
--     roster_entry nasce com a posição definida; no fim apaga pendentes que ninguém ganhou (e os lances deles).
--   * leilao_previa e consolidar_mercado_previa marcam "[NOVO · posição]".  buscar_jogadores não mostra pendentes.
-- Reversão: restaurar leilao_commit do 20261026_foto_na_consolidacao/original; drop function dar_lance_novo, set_novo_jogador;
--   alter table players drop column is_pending, drop column pending_position; (desfazer os replace das prévias/busca)

alter table public.players add column if not exists is_pending boolean not null default false;
alter table public.players add column if not exists pending_position text;
alter table public.players drop constraint if exists players_pending_position_check;
alter table public.players add constraint players_pending_position_check
  check (pending_position is null or pending_position in ('PG','SG','SF','PF','C','PG/SG','SG/SF','SF/PF','PF/C'));
create index if not exists players_pending_idx on public.players (id) where is_pending;

create or replace function public.dar_lance_novo(_name text, _salary_offer bigint, _week integer)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_team uuid := public.current_team_id();
  v_season_id uuid; v_start integer; v_open boolean;
  v_name text; v_key text; v_pid uuid; v_pend boolean; v_cnt integer; v_tname text;
begin
  if v_team is null then raise exception 'Você não tem um time ativo (não é GM?).'; end if;
  select id, start_year into v_season_id, v_start from public.seasons where is_current = true;
  select is_open into v_open from public.market_state where season_id = v_season_id;
  if coalesce(v_open, false) then
    raise exception 'Mercado aberto — lances de free agent estão fechados agora.';
  end if;

  v_name := btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g'));
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'Informe o nome completo do jogador (3 a 80 caracteres).';
  end if;
  if v_name !~ '^[[:alpha:]][[:alpha:] .''’-]*$' then
    raise exception 'O nome deve ter só letras (pode ter espaço, ponto, hífen e apóstrofo).';
  end if;
  v_key := public.norm_busca(v_name);

  select id, is_pending into v_pid, v_pend from public.players where public.norm_busca(full_name) = v_key limit 1;
  if v_pid is not null then
    select t.name into v_tname from public.roster_entries re join public.teams t on t.id = re.team_id
     where re.player_id = v_pid and re.season = v_start limit 1;
    if v_tname is not null then
      raise exception 'Esse jogador já está em um elenco (%): não é free agent.', v_tname;
    end if;
  else
    select count(*) into v_cnt from public.free_agent_bids b join public.players p on p.id = b.player_id
     where b.team_id = v_team and b.season_id = v_season_id and b.week_number = _week
       and b.status = 'active' and p.is_pending;
    if v_cnt >= 5 then
      raise exception 'Limite de 5 jogadores novos por semana para o seu time.';
    end if;
    insert into public.players (full_name, is_pending) values (v_name, true) returning id into v_pid;
  end if;

  return public.dar_lance(v_pid, _salary_offer, _week);
end $fn$;

create or replace function public.set_novo_jogador(_player_id uuid, _full_name text, _position text, _espn_id text default null)
returns text
language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text; v_pend boolean;
begin
  if not public.has_role('admin') then raise exception 'Apenas admin define dados de jogador novo.'; end if;
  select is_pending into v_pend from public.players where id = _player_id;
  if v_pend is null then raise exception 'Jogador não encontrado.'; end if;
  if not v_pend then raise exception 'Esse jogador não é novo/pendente.'; end if;
  v_name := btrim(regexp_replace(coalesce(_full_name, ''), '\s+', ' ', 'g'));
  if char_length(v_name) < 3 then raise exception 'Nome inválido.'; end if;
  if exists (select 1 from public.players p where p.id <> _player_id and public.norm_busca(p.full_name) = public.norm_busca(v_name)) then
    raise exception 'Já existe um jogador com esse nome no banco (%). Peça ao GM um novo lance nele ou ajuste o nome.', v_name;
  end if;
  if _position is not null and _position not in ('PG','SG','SF','PF','C','PG/SG','SG/SF','SF/PF','PF/C') then
    raise exception 'Posição inválida: %.', _position;
  end if;
  update public.players
     set full_name = v_name,
         pending_position = coalesce(_position, pending_position),
         espn_id = nullif(btrim(coalesce(_espn_id, '')), ''),
         updated_at = now()
   where id = _player_id;
  return 'Jogador novo atualizado.';
end $fn$;

create or replace function public.leilao_commit(_season_id uuid, _week integer)
returns text
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_start_year integer;
  v_label      text;
  v_w          record;
  v_tx         uuid;
  v_re         uuid;
  v_signed     integer := 0;
  v_lost       integer := 0;
  v_missing    text;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas admin consolida o leilão.';
  end if;

  select start_year, label into v_start_year, v_label from public.seasons where id = _season_id;

  drop table if exists _winners;
  create temp table _winners on commit drop as
    select * from public.leilao_resolver(_season_id, _week);

  -- jogador novo que venceu precisa de posição definida pelo admin antes de consolidar
  select string_agg(p.full_name, ', ' order by p.full_name) into v_missing
    from _winners w join public.players p on p.id = w.player_id
   where p.is_pending and p.pending_position is null;
  if v_missing is not null then
    raise exception 'Defina a posição dos jogadores novos antes de consolidar: %.', v_missing;
  end if;

  for v_w in select * from _winners loop
    insert into public.transactions (type, status, season_id, week_number, proposed_by, executed_at)
    values ('signing', 'executed', _season_id, _week, null, now())
    returning id into v_tx;

    insert into public.roster_entries (team_id, player_id, season, status, position, acquired_via)
    values (
      v_w.team_id, v_w.player_id, v_start_year, 'active',
      coalesce(
        (select re2.position
           from public.roster_entries re2
          where re2.player_id = v_w.player_id
            and re2.position is not null
          order by re2.season desc
          limit 1),
        (select pl.pending_position from public.players pl where pl.id = v_w.player_id)),
      'signing')
    returning id into v_re;

    insert into public.roster_contract_years (roster_entry_id, season_label, salary)
    values (v_re, v_label, v_w.salary_offer);

    insert into public.transaction_items (transaction_id, asset_type, player_id, to_team_id, amount)
    values (v_tx, 'player', v_w.player_id, v_w.team_id, v_w.salary_offer);

    update public.free_agent_bids
       set status = 'won'
     where season_id = _season_id and week_number = _week
       and player_id = v_w.player_id and team_id = v_w.team_id and status = 'active';

    -- jogador novo oficializado
    update public.players set is_pending = false, pending_position = null, updated_at = now()
     where id = v_w.player_id and is_pending;

    v_signed := v_signed + 1;
  end loop;

  update public.free_agent_bids
     set status = 'lost'
   where season_id = _season_id and week_number = _week and status = 'active';
  get diagnostics v_lost = row_count;

  -- limpeza: jogador novo que ninguém ganhou some (lances dele já foram avisados como perdidos)
  delete from public.free_agent_bids b using public.players p
   where b.player_id = p.id and p.is_pending and b.status <> 'active';
  delete from public.players p
   where p.is_pending and not exists (select 1 from public.free_agent_bids b where b.player_id = p.id);

  return format('Leilão consolidado: %s contratação(ões), %s lance(s) perdedor(es).', v_signed, v_lost);
end $fn$;

-- Patches por substituição na definição (aplicados via DO + pg_get_functiondef; abortam se o trecho não existir):
--  buscar_jogadores: 'where not exists (select 1 from unnest(v_terms) term' -> 'where not p.is_pending and not exists (...'
--  leilao_previa: 'select r.player_id, p.full_name, r.team_id' -> p.full_name || ' [NOVO · pos]' quando is_pending
--  consolidar_mercado_previa: format('%s -> %s (%s)', p.full_name, ... -> idem com o marcador [NOVO · pos]

revoke all on function public.dar_lance_novo(text, bigint, integer), public.set_novo_jogador(uuid, text, text, text) from public, anon;
grant execute on function public.dar_lance_novo(text, bigint, integer), public.set_novo_jogador(uuid, text, text, text) to authenticated;
