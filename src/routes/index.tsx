import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Trophy, Users, CalendarDays, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Liga Bola Presa de Fantasy — Temporada 2025/26" },
      {
        name: "description",
        content:
          "Acompanhe a Liga Bola Presa de Fantasy NBA: classificação ao vivo, elencos, escalações, calendário e narrativas dos jogos.",
      },
      { property: "og:title", content: "Liga Bola Presa de Fantasy" },
      {
        property: "og:description",
        content: "Liga de NBA Fantasy desde 2006. Temporada 2025/26 em andamento.",
      },
    ],
  }),
  component: HomePage,
});

// Mock — será substituído pela leitura da planilha "Classificação".
const standings = [
  { pos: 1, team: "Floripa Waves", w: 18, l: 4, pct: 0.818, streak: "V4" },
  { pos: 2, team: "Dengue State Outlawz", w: 16, l: 6, pct: 0.727, streak: "V2" },
  { pos: 3, team: "Campos Oilers", w: 14, l: 8, pct: 0.636, streak: "D1" },
  { pos: 4, team: "Palmas Mamíferos", w: 13, l: 9, pct: 0.591, streak: "V1" },
  { pos: 5, team: "Old Devils", w: 12, l: 10, pct: 0.545, streak: "V3" },
  { pos: 6, team: "Lighthalzen", w: 10, l: 12, pct: 0.455, streak: "D2" },
  { pos: 7, team: "Kissflowers", w: 8, l: 14, pct: 0.364, streak: "D1" },
  { pos: 8, team: "Racecars", w: 5, l: 17, pct: 0.227, streak: "D5" },
];

const shortcuts = [
  { to: "/elencos", label: "Elencos", desc: "Times e jogadores", icon: Users },
  { to: "/calendario", label: "Calendário", desc: "Próximas rodadas", icon: CalendarDays },
  { to: "/escalacoes", label: "Escalações", desc: "Quem joga essa semana", icon: ClipboardList },
  { to: "/recordes", label: "Recordes", desc: "Marcas históricas", icon: Trophy },
] as const;

function HomePage() {
  return (
    <div>
      {/* HERO — último jogo */}
      <section className="border-b border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 md:px-8 md:py-16 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-[color:var(--court)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--court)]" />
              LBP Finals · 2025/26
            </p>
            <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight md:text-5xl lg:text-6xl">
              Floripa Waves <span className="text-muted-foreground">x</span>{" "}
              Dengue State Outlawz
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              A grande final da temporada começa nesta semana. Duas franquias com histórias
              diferentes em busca do mesmo troféu.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/noticias"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Ler narrativa do jogo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link
                to="/classificacao"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Ver classificação
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="flex h-full flex-col">
                <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-br from-[color:var(--court)]/10 via-background to-[color:var(--gold)]/10 p-8">
                  <div className="text-center">
                    <p className="font-display text-5xl tracking-tight">WAVES</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Floripa
                    </p>
                  </div>
                  <div className="h-px w-12 bg-border" />
                  <p className="font-display text-2xl text-muted-foreground">vs</p>
                  <div className="h-px w-12 bg-border" />
                  <div className="text-center">
                    <p className="font-display text-5xl tracking-tight">OUTLAWZ</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Dengue State
                    </p>
                  </div>
                </div>
                <div className="border-t border-border bg-muted/40 px-6 py-3 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Jogo 1 · 24 de março
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLASSIFICAÇÃO */}
      <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-8 md:py-16">
        <div className="flex items-end justify-between border-b border-border pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Temporada 2025/26
            </p>
            <h2 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
              Classificação
            </h2>
          </div>
          <Link
            to="/classificacao"
            className="hidden text-sm text-[color:var(--court)] transition-colors hover:underline sm:inline-flex sm:items-center sm:gap-1"
          >
            Tabela completa <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 text-right font-semibold">V</th>
                <th className="px-4 py-3 text-right font-semibold">D</th>
                <th className="px-4 py-3 text-right font-semibold">PCT</th>
                <th className="px-4 py-3 text-right font-semibold">Seq.</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr
                  key={row.team}
                  className={`border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40 ${
                    i % 2 === 1 ? "bg-muted/15" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-display text-base text-muted-foreground">
                    {row.pos}
                  </td>
                  <td className="px-4 py-3 font-medium">{row.team}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.w}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {row.l}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {row.pct.toFixed(3).replace(/^0/, "")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex h-6 min-w-8 items-center justify-center rounded px-1.5 text-[11px] font-semibold tabular-nums ${
                        row.streak.startsWith("V")
                          ? "bg-[color:var(--court)]/10 text-[color:var(--court)]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.streak}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Dados de demonstração. Conectaremos sua planilha do Google Sheets em seguida.
        </p>
      </section>

      {/* ATALHOS */}
      <section className="mx-auto max-w-[1200px] px-4 pb-16 md:px-8">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {shortcuts.map(({ to, label, desc, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-3 bg-card p-5 transition-colors hover:bg-accent"
            >
              <Icon className="h-5 w-5 text-[color:var(--court)]" />
              <div>
                <p className="font-display text-lg tracking-tight">{label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </div>
              <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
