-- 20261022_finalizar_confronto.sql
-- Fase 3 (resultados ao vivo): persistir o resultado de um confronto lido da
-- planilha. O server fn lê a planilha (gviz), casa nome->player_id e monta o
-- _payload; estas RPCs gravam de forma ATÔMICA (função = transação) e validam
-- admin (has_role). Idempotentes: refechar apaga e regrava as linhas do jogo.
--
-- Como as RPCs de standings/recordes filtram status='final', o jogo entra
-- sozinho na classificação assim que finalizado.

-- ── Finalizar um confronto ──────────────────────────────────────────────────────
create or replace function public.finalizar_confronto(_game_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _found boolean;
  _n_players int;
  _n_cats int;
begin
  if not public.has_role('admin') then
    raise exception 'Apenas administradores podem finalizar confrontos.';
  end if;

  select true into _found from games where id = _game_id;
  if _found is null then
    raise exception 'Confronto % não encontrado.', _game_id;
  end if;

  -- idempotente: limpa o que havia e regrava (pelo definer, delete funciona)
  delete from player_game_stats     where game_id = _game_id;
  delete from game_category_results where game_id = _game_id;

  insert into player_game_stats
    (game_id, team_id, player_id, pts, reb, ast, stl, blk, three_pm, turnovers, lineup_order)
  select _game_id, p.team_id, p.player_id, p.pts, p.reb, p.ast, p.stl, p.blk, p.three_pm, p.turnovers, p.lineup_order
  from jsonb_to_recordset(_payload->'players') as p(
    team_id uuid, player_id uuid, pts numeric, reb numeric, ast numeric, stl numeric,
    blk numeric, three_pm numeric, turnovers numeric, lineup_order int
  );
  get diagnostics _n_players = row_count;

  insert into game_category_results
    (game_id, team_id, category_key, value, won_category)
  select _game_id, c.team_id, c.category_key, c.value, c.won_category
  from jsonb_to_recordset(_payload->'categories') as c(
    team_id uuid, category_key text, value numeric, won_category boolean
  );
  get diagnostics _n_cats = row_count;

  update games set
    status          = 'final',
    home_score      = (_payload->>'home_score')::int,
    away_score      = (_payload->>'away_score')::int,
    tied_categories = coalesce((_payload->>'tied_categories')::int, 0),
    played_on       = (_payload->>'played_on')::date,
    updated_at      = now()
  where id = _game_id;

  return jsonb_build_object('ok', true, 'game_id', _game_id, 'players', _n_players, 'categories', _n_cats);
end;
$$;

-- ── Reabrir um confronto (desfazer o fechamento) ────────────────────────────────
create or replace function public.reabrir_confronto(_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Apenas administradores podem reabrir confrontos.';
  end if;

  delete from player_game_stats     where game_id = _game_id;
  delete from game_category_results where game_id = _game_id;

  update games set
    status          = 'scheduled',
    home_score      = 0,
    away_score      = 0,
    tied_categories = 0,
    played_on       = null,
    updated_at      = now()
  where id = _game_id;

  return jsonb_build_object('ok', true, 'game_id', _game_id, 'reopened', true);
end;
$$;

grant execute on function public.finalizar_confronto(uuid, jsonb) to authenticated;
grant execute on function public.reabrir_confronto(uuid)          to authenticated;
