-- 02/11/2026 — Regra 1: bloqueio da 1ª própria (nunca 2 anos seguidos sem a própria 1ª). JÁ APLICADO em PROD via MCP.
-- Regra: a 1ª própria do ano Y fica indisponível para troca se o time não tem a própria 1ª de Y-1 ou Y+1
-- (só contam anos que existem em draft_picks; 26/27 já passou e 31/32 ainda não existe). Pick sem linha = "não tem".
-- Elencos que já estão fora da regra ficam como estão (decisão do dono); só bloqueia trocas novas.

-- 0) Correções de dados nas picks (conferidas na planilha de elencos + e-mails do grupo)
-- 1ª 27/28 do Campos Lighthalzen estava lançada em 28/29 (linha do Gold Lions): passa a 27/28, sem disputa.
update draft_picks set draft_season_id=(select id from seasons where label='27/28'), disputed=false, updated_at=now()
 where id='6ee6a4c3-e981-4622-ad48-2dca16594565';
update draft_picks set disputed=false, updated_at=now() where id='5cecf738-8d2e-44d2-9e74-f5774d3063a3';
-- 1ª 28/29 do João Pessoa Fats pertence ao Palmas Mamíferos (troca de 16/10).
update draft_picks set current_team_id=(select id from teams where name='Palmas Mamiferos'), updated_at=now()
 where id='e11f06d1-8b77-446e-ab6d-73089b3772d5';
-- 2ª 29/30 do Rio Preto Capivaras não tinha linha: criada com o próprio Capivaras.
insert into draft_picks (draft_season_id, round, original_team_id, current_team_id)
select (select id from seasons where label='29/30'), 2, t.id, t.id from teams t where t.name='Rio Preto Capivaras'
  and not exists (select 1 from draft_picks d where d.round=2 and d.original_team_id=t.id
                  and d.draft_season_id=(select id from seasons where label='29/30'));

-- 1) Status por pick (telas): get_picks_proprias_status()  [anon + authenticated]
create or replace function public.get_picks_proprias_status()
returns table(pick_id uuid, team_id uuid, season_label text, locked boolean, reason text)
language sql stable security definer set search_path = public as $$
  with yrs as (
    select s.id, s.label, s.start_year from public.seasons s
    where exists (select 1 from public.draft_picks d where d.draft_season_id = s.id)
  ),
  own as (
    select d.original_team_id t, d.draft_season_id sid from public.draft_picks d
    where d.round = 1 and d.current_team_id = d.original_team_id and not d.is_used
  ),
  p as (
    select d.id, d.original_team_id t, y.label, y.start_year
    from public.draft_picks d join yrs y on y.id = d.draft_season_id
    where d.round = 1 and d.current_team_id = d.original_team_id and not d.is_used
  )
  select p.id, p.t, p.label, (m.lbl is not null),
         case when m.lbl is not null then 'sem a própria 1ª de ' || m.lbl end
  from p
  left join lateral (
    select y2.label lbl from yrs y2
    where y2.start_year in (p.start_year - 1, p.start_year + 1)
      and not exists (select 1 from own o where o.t = p.t and o.sid = y2.id)
    order by y2.start_year limit 1
  ) m on true
$$;
grant execute on function public.get_picks_proprias_status() to anon, authenticated;

-- 2) Validação da proposta (conjunto de itens, simulando o estado pós-troca). Interna, sem grant.
create or replace function public.validar_picks_proprias_troca(_itens jsonb)
returns void
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  for r in
    with yrs as (
      select s.id, s.label, s.start_year from public.seasons s
      where exists (select 1 from public.draft_picks d where d.draft_season_id = s.id)
    ),
    sent as (
      select (e->>'pick_id')::uuid pid, (e->>'from_team_id')::uuid f, (e->>'to_team_id')::uuid t
      from jsonb_array_elements(_itens) e where e->>'asset_type' = 'pick'
    ),
    after_own as (
      select d.original_team_id team, d.draft_season_id sid from public.draft_picks d
      where d.round = 1 and d.current_team_id = d.original_team_id and not d.is_used
        and not exists (select 1 from sent s where s.pid = d.id and s.f = d.original_team_id)
      union
      select d.original_team_id, d.draft_season_id from public.draft_picks d
      join sent s on s.pid = d.id where d.round = 1 and s.t = d.original_team_id
    ),
    sentown as (
      select d.original_team_id team, y.label, y.start_year
      from sent s join public.draft_picks d on d.id = s.pid
      join yrs y on y.id = d.draft_season_id
      where d.round = 1 and s.f = d.original_team_id
    )
    select so.label, (select name from public.teams where id = so.team) tname, m.lbl
    from sentown so
    join lateral (
      select y2.label lbl from yrs y2
      where y2.start_year in (so.start_year - 1, so.start_year + 1)
        and not exists (select 1 from after_own a where a.team = so.team and a.sid = y2.id)
      order by y2.start_year limit 1
    ) m on true
    order by so.start_year
  loop
    raise exception 'A 1ª de % do % está indisponível para troca: o time ficaria sem a própria 1ª de % (regra: nunca 2 anos seguidos sem a própria 1ª).', r.label, r.tname, r.lbl;
  end loop;
end $$;

create or replace function public.validar_picks_proprias_troca_tx(_tx uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.validar_picks_proprias_troca((
    select coalesce(jsonb_agg(jsonb_build_object('asset_type', ti.asset_type, 'pick_id', ti.pick_id,
             'from_team_id', ti.from_team_id, 'to_team_id', ti.to_team_id)), '[]'::jsonb)
    from public.transaction_items ti where ti.transaction_id = _tx
  ));
end $$;
revoke all on function public.validar_picks_proprias_troca(jsonb) from public, anon, authenticated;
revoke all on function public.validar_picks_proprias_troca_tx(uuid) from public, anon, authenticated;

-- 3) Encaixe nas funções existentes (patch por DO, abortando se a âncora não existir):
--  propor_troca: `perform validar_picks_proprias_troca(_itens);` antes do bloco de multa mínima
--  executar_troca: `perform validar_picks_proprias_troca_tx(_tx_id);` no início do BEGIN (falha => tx 'failed')
--  publicar_trade_block: recusa pick bloqueada; get_trade_block_ofertaveis: não lista pick bloqueada
-- (ver as definições atuais com pg_get_functiondef)

-- Testes (rollback): 10/10 — Horse Ride 28/29 bloqueada=erro; Papão 28/29 sozinha=ok; 28/29+29/30=erro;
-- 27/28+29/30=ok; 27/28+28/29=erro; Floripa 30/31=erro; pick de outro time=ok; Lighthalzen 30/31=ok;
-- Floripa 30/31 recebendo a própria 29/30 de volta=ok; 2ª rodada seguidas=ok.
-- Resultado: get_picks_proprias_status() bloqueia exatamente as 11 picks vermelhas da planilha de elencos.
