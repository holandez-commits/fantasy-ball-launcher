
# Plano: Modernizar o site da Liga Bola Presa de Fantasy

## Visão geral
Vamos começar com uma **vitrine moderna** que reaproveita seus dados atuais (planilhas Google + posts do Blogger), com visual clean/minimalista. A ideia é entregar algo bonito e funcional rápido, e depois evoluir para uma plataforma completa em fases futuras.

## Fase 1 — O que vamos construir agora

### Estrutura de páginas (rotas separadas)
```
/                  Home — destaque para a classificação + último jogo
/classificacao     Tabela completa da temporada
/elencos           Times e seus jogadores
/calendario        Jogos da temporada
/escalacoes        Escalações da rodada
/medias            Médias dos jogadores
/recordes          Recordes históricos e da temporada
/regras            Regras + divisões/conferências + premiação + rookie scale
/noticias          Lista de posts/narrativas de jogos
/noticias/$slug    Post individual
```

### Visual (clean e minimalista)
- Tema claro, muito espaço em branco, foco no conteúdo
- Tipografia elegante (Inter para texto, uma serif sutil para títulos de matérias)
- Paleta neutra com 1 cor de destaque (sugiro um azul profundo, mas posso usar dourado se quiser manter a vibe do logo atual)
- Cards limpos para times, jogadores e jogos
- Tabelas modernas com sticky header e zebra striping sutil
- Logo "Bola Presa" reaproveitado no header

### Home page (destaque combinado)
1. Header com navegação
2. Hero compacto com o último jogo (imagem + título + link)
3. **Tabela de classificação resumida** (top times) — em destaque
4. Atalhos rápidos para Elencos, Calendário, Escalações
5. Lista das 3 notícias mais recentes
6. Footer com links secundários

### Como os dados vão chegar no site
- **Planilhas (Classificação, Médias, Elencos, Calendário, Escalações, Rookie Scale, Premiação)**: integradas via conector do **Google Sheets** — o site lê as planilhas que você já mantém e renderiza como tabelas modernas. Você continua editando no Google Sheets, o site reflete automaticamente.
- **Notícias/narrativas de jogos**: armazenadas no banco do Lovable Cloud, com painel de admin onde você e os GMs convidados publicam direto pelo site (substituindo o Blogger aos poucos).

### Login (você + amigos)
- Lovable Cloud com autenticação por e-mail
- Dois papéis: **admin** (você) e **editor** (amigos GMs)
- Admins gerenciam usuários e tudo; editores criam/editam posts
- Upload de imagem de capa para cada post

## Fase 2 — Evolução futura (não faremos agora, só registrando)
- Migrar dados das planilhas para banco próprio
- Cada GM monta sua escalação direto pelo site
- Sistema de trocas com aprovação
- Histórico de temporadas anteriores navegável
- Estatísticas calculadas automaticamente

## Detalhes técnicos
- **Stack**: TanStack Start (já configurado) + Tailwind + shadcn/ui
- **Banco/Auth/Storage**: Lovable Cloud (será habilitado)
- **Conector Google Sheets**: você vai precisar conectar sua conta Google que tem acesso às planilhas (faço a solicitação no momento certo)
- **Rotas separadas com SEO próprio** em cada página
- **Posts** ficam em tabela `posts` (título, slug, conteúdo markdown, capa, autor, data); papéis em tabela `user_roles` separada (boa prática de segurança)

## Como funciona daqui pra frente
Para responder sua pergunta original — você **não precisa** escrever prompts complexos. O ideal é trabalhar em pedidos pequenos e iterativos:
1. Aprovo este plano → eu construo a estrutura base + visual + home
2. Você testa, me diz o que mudar ("aumenta o logo", "muda a cor pra dourado", "a tabela tá apertada")
3. Vamos adicionando seção por seção (primeiro classificação, depois elencos, etc.)
4. Por último ativamos login + área de notícias

## O que preciso de você antes de começar
- Confirmar se posso usar **azul profundo** como cor de destaque, ou se prefere manter o **dourado/azul** da identidade atual
- Quando eu pedir, você precisará: (1) habilitar Lovable Cloud com 1 clique, (2) conectar sua conta Google do Sheets

Se aprovar, começo pela estrutura + home + integração da classificação.
