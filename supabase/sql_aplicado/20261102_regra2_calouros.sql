-- Regra 2 (S20): calouros dispensados sem multa nos 2 ultimos anos de contrato.
-- Aplicado em 2026-11-02. Regra: anos 1-2 = multa normal (multa_pct; salario <= $2M ja e 0%);
-- anos 3-4 (ultimos 2 do contrato) = sem multa. A isencao acompanha o jogador em troca.
-- Origem da lista: salarios em fonte vermelha na planilha de elencos (+ Veesaar, confirmado pelo usuario).

alter table public.roster_entries add column if not exists contrato_calouro boolean not null default false;
comment on column public.roster_entries.contrato_calouro is
  'Contrato de calouro: os 2 ultimos anos de roster_contract_years nao geram multa na dispensa (executar_dispensa_core).';

-- Marcacao (91 jogadores, temporada 2026 = 26/27). Nomes casados via norm_busca; variantes da planilha
-- ja convertidas para o nome do banco no momento da aplicacao (ex.: Cam Boozer -> Cameron Boozer).
-- Lista original (time da planilha, nome da planilha):
/*
('Floripa Waves','Jaime Jaquez Jr'),
('Cambuquira Pure Water','Jeremiah Fears'),
('Cambuquira Pure Water','Keaton Wagler'),
('Pará Papão','Brayden Burries'),
('Pará Papão','Amen Thompson'),
('Pará Papão','Jaden Bradley'),
('Pará Papão','Yaxel Lendeborg'),
('Pará Papão','Kel''el Ware'),
('Goiânia Old Devils','Labaron Philon'),
('Goiânia Old Devils','V.J. Edgecombe'),
('Goiânia Old Devils','Cason Wallace'),
('Goiânia Old Devils','Ronald Holland'),
('Goiânia Old Devils','Dereck Lively'),
('Tijuca Rocks','Tre Johnson'),
('Tijuca Rocks','Cameron Carr'),
('Tijuca Rocks','Ausar Thompson'),
('Tijuca Rocks','Cooper Flagg'),
('SP Horse Ride','Kasparas Jakucionis'),
('SP Horse Ride','Jaylon Tyson'),
('Brasilia Carcarás','Bruce Thornton'),
('Brasilia Carcarás','Emanuel Sharp'),
('Brasilia Carcarás','Danny Wolf'),
('Brasilia Carcarás','Morez Johnson'),
('Brasilia Carcarás','Henri Veesaar'),
('JPA KissFlowers','Ben Sheppard'),
('JPA KissFlowers','Will Riley'),
('JPA KissFlowers','Hansen Yang'),
('João Pessoa Fats','Meleek Thomas'),
('João Pessoa Fats','Hannes Steinbach'),
('João Pessoa Fats','Quinten Post'),
('João Pessoa Fats','Derik Queen'),
('João Pessoa Fats','Zach Edey'),
('Prudente Bengals','Bennett Stirtz'),
('Prudente Bengals','Anthony Black'),
('Prudente Bengals','Carter Bryant'),
('Palmas Mamiferos','Scoot Henderson'),
('Palmas Mamiferos','Bilal Coulibaly'),
('Palmas Mamiferos','Joan Beringer'),
('Palmas Mamiferos','Khaman Maluach'),
('Recife Gold Lions','Nikola Topic'),
('Recife Gold Lions','Christian Anderson'),
('Recife Gold Lions','Ja''Kobe Walter'),
('Recife Gold Lions','Egor Demin'),
('Recife Gold Lions','Brandon Miller'),
('Recife Gold Lions','Matas Buzelis'),
('Recife Gold Lions','Donovan Clingan'),
('Recife Gold Lions','Maxime Raynaud'),
('Campos Oilers','Cam Boozer'),
('Blumenau Assassins','Jared McCain'),
('Blumenau Assassins','Karim Lopez'),
('Blumenau Assassins','Asa Newell'),
('Rio Preto Capivaras','Calton Carrington'),
('RJ Drugdealers','Kingston Fleming'),
('RJ Drugdealers','Koa Peat'),
('RJ Drugdealers','Kyle Filipowiski'),
('Porto Alegre Ornitorrincos','Stephon Castle'),
('Porto Alegre Ornitorrincos','Ace Bailey'),
('Porto Alegre Ornitorrincos','Tristan Da Silva'),
('Porto Alegre Ornitorrincos','Aday Mara'),
('Porto Alegre Ornitorrincos','Alexandre Sarr'),
('Dengue State Outlawz','Isaiah Collier'),
('Dengue State Outlawz','Allen Graves'),
('Pinheiros Racecars','Keyonte George'),
('Pinheiros Racecars','Sergio De Larrea'),
('Pinheiros Racecars','Collin Murray-Boyles'),
('Pinheiros Racecars','Yves Missi'),
('Lavras Big Balls','Nate Ament'),
('Lavras Big Balls','Victor Wembanyama'),
('Santo André Balboas','Darius Acuff'),
('Santo André Balboas','Ebuka Okorie'),
('Santo André Balboas','Walter Clayton Jr'),
('Santo André Balboas','Reed Sheppard'),
('Santo André Balboas','Cedric Coward'),
('Santo André Balboas','Jaylen Wells'),
('Santo André Balboas','Ryan Kalkbrenner'),
('Santo André Balboas','Otega Oweh'),
('São Paulo TrafficJam','Mikel Brown Jr.'),
('São Paulo TrafficJam','Noah Penda'),
('São Paulo TrafficJam','Chris Cenac'),
('São Paulo TrafficJam','Tarris Reed'),
('Campinas Color Blinds','Dylan Harper'),
('Campinas Color Blinds','Kon Knueppel'),
('Campinas Color Blinds','Dailyn Swain'),
('Campinas Color Blinds','Tidjane Salaün'),
('Campinas Color Blinds','Caleb Wilson'),
('Campos Lighthalzen','Ryan Conwell'),
('Campos Lighthalzen','Nique Clifford'),
('Campos Lighthalzen','Trevon Brazile'),
('Campos Lighthalzen','Zuby Ejiofor'),
('Campos Lighthalzen','Baba Miller'),
('Campos Lighthalzen','Moses Moody')
*/

-- executar_dispensa_core: patch aplicado (definicao completa no banco). Trecho novo:
--   select coalesce(re.contrato_calouro,false) into v_cal from roster_entries re where re.id = v_re_id;
--   select count(*) into v_ncy from roster_contract_years cy where cy.roster_entry_id = v_re_id;
--   loop (order by season_label): v_i := v_i + 1;
--     if v_cal and v_i > v_ncy - 2 then v_isentos := v_isentos || to_jsonb(season_label); continue; end if;
--   email_snapshot passa a incluir 'calouro' e 'isentos' (trg_email_tx_executed copia o snapshot inteiro).
-- Teste (rollback): Brayden Burries 2.25M/2.5M/2.7M/3.7M -> calouro: multa 500.000 (26/27 e 27/28);
--   nao calouro: 1.100.000 em 4 anos.
-- Edge Function enviar-resumo-liga v4: linha "Contrato de calouro: sem multa em XX e YY." no e-mail de dispensa.
-- Pendente: rollover de temporada deve manter contrato_calouro; draft de novos calouros (nao definido).
