-- 20261105_renomear_campos_light_city.sql
-- Renomeia o time "Campos Lighthalzen" para "Campos Light City" (nome e slug) e corrige o nome
-- nas notificações já gravadas (título e texto). Abreviação (LIG) e sheet_nickname não mudaram.
update public.teams set name = 'Campos Light City', slug = 'campos-light-city'
 where id = '813c2693-3a74-4a0a-ac4c-677b17d22fa2' and name = 'Campos Lighthalzen';
update public.notifications set title = replace(title, 'Campos Lighthalzen', 'Campos Light City') where title like '%Campos Lighthalzen%';
update public.notifications set body = replace(body, 'Campos Lighthalzen', 'Campos Light City') where body like '%Campos Lighthalzen%';
