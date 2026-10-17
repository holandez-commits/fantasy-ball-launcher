--
-- PostgreSQL database dump
--

\restrict Jff6GBgLRnElI9pmJ26FebFkRmFGscI2cDoNPsgqpGqrWGq3R72HqiTFx3kkCdh

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (key, display_name, display_order, lower_is_better) FROM stdin;
pts	Pontos	1	f
reb	Rebotes	2	f
ast	Assistências	3	f
stl	Roubos	4	f
blk	Tocos	5	f
3pm	Bolas de 3	6	f
to	Turnovers	7	t
\.


--
-- Data for Name: positions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.positions (id, code, name, sort_order, accepts_any) FROM stdin;
c59904cb-020a-4187-99cc-33e8a2dcbeae	PG	Armador	1	f
8cf0a95f-aa57-49e4-af6a-e9c4fea9c63e	SG	Ala-armador	2	f
6b731a98-356f-4c49-8bba-f4b421aa2305	SF	Ala	3	f
ecd09980-b630-4cf6-8239-dfb5e1208d80	PF	Ala-pivô	4	f
ae237e38-e07e-4166-8e55-09d052e0ab24	C	Pivô	5	f
b97cec6b-d716-49df-8c66-26b5cc5c7964	6H	Sexto Homem	6	t
\.


--
-- Data for Name: seasons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.seasons (id, label, start_year, end_year, total_weeks, playoff_start_week, is_current, is_completed, created_at, updated_at) FROM stdin;
7fb9c609-3d15-4ebf-b09a-6dad165e889e	22/23	2022	2023	17	\N	f	t	2026-05-03 02:43:35.863431+00	2026-05-03 02:43:35.863431+00
52a6b14e-5441-4b69-9061-5c3f4e530c61	23/24	2023	2024	17	\N	f	t	2026-05-03 02:43:35.863431+00	2026-05-03 02:43:35.863431+00
d997f1a1-0a0b-4561-a970-98314040a77e	24/25	2024	2025	17	\N	f	t	2026-05-03 02:43:35.863431+00	2026-05-03 02:43:35.863431+00
81d36136-18a1-469f-94a8-420f4a03c292	19/20	2019	2020	17	\N	f	f	2026-05-09 02:21:35.467403+00	2026-05-09 02:21:35.467403+00
1a1c709a-bd35-4988-b74f-302994e77203	20/21	2020	2021	17	\N	f	f	2026-05-09 02:21:35.467403+00	2026-05-09 02:21:35.467403+00
c726e1ed-c015-48a6-bbf3-895c93164539	21/22	2021	2022	17	\N	f	f	2026-05-09 02:21:35.467403+00	2026-05-09 02:21:35.467403+00
1754f71f-505f-4208-b91f-b3528a3cb911	18/19	2018	2019	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
e59154d7-1787-4cb3-a8a4-cbe15ee0dcf2	17/18	2017	2018	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
3938e5ae-6f11-437b-9d2f-f39006434c86	16/17	2016	2017	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
38e2e0f3-5a5b-4500-b2ed-08c41f5f7a50	15/16	2015	2016	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
8870391f-c37d-48c8-ae1f-b57f9c714327	14/15	2014	2015	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
8cc55c27-0e89-4eae-b16c-55c234717916	13/14	2013	2014	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
c12a4827-d289-45e4-a76a-b395ad8bcd46	12/13	2012	2013	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
66bf4de1-3dc8-4572-bd40-372c9fdc2d2e	11/12	2011	2012	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
3021be7a-6e70-484e-b50d-e8888c09cb79	10/11	2010	2011	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
6007ff4e-150b-46cc-b627-a522abd0ae49	09/10	2009	2010	17	\N	f	f	2026-05-09 12:09:42.844417+00	2026-05-09 12:09:42.844417+00
1b93d42d-30f2-4868-a521-23c61fed2687	27/28	2027	2028	17	\N	f	f	2026-10-06 00:51:30.769121+00	2026-10-06 00:51:30.769121+00
ba007e59-2b1d-4066-90a9-dab85156fc7e	28/29	2028	2029	17	\N	f	f	2026-10-06 00:51:30.769121+00	2026-10-06 00:51:30.769121+00
89b57706-ebf8-4047-8106-86c347b952db	29/30	2029	2030	17	\N	f	f	2026-10-06 00:51:30.769121+00	2026-10-06 00:51:30.769121+00
54c9f315-826b-4448-a428-8725a21e22ec	30/31	2030	2031	17	\N	f	f	2026-10-06 00:51:30.769121+00	2026-10-06 00:51:30.769121+00
1f5c195a-508f-4514-9143-a000481a48d1	25/26	2025	2026	17	\N	f	t	2026-04-28 20:22:07.117598+00	2026-10-06 01:53:57.078931+00
44971679-73f9-4b6b-9223-4e91a0a27428	26/27	2026	2027	17	\N	t	f	2026-10-06 00:51:30.769121+00	2026-10-06 01:53:57.078931+00
\.


--
-- PostgreSQL database dump complete
--

\unrestrict Jff6GBgLRnElI9pmJ26FebFkRmFGscI2cDoNPsgqpGqrWGq3R72HqiTFx3kkCdh

