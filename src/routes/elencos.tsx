import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../integrations/supabase/client";
import { ChevronRight, Shield } from "lucide-react";

type TeamRow = {
  id: string;
  name: string;
  abbreviation: string;
  slug: string;
  conference: string | null;
  primary_color: string | null;
  logo_url: string | null;
  gm: { id: string; full_name: string; nickname: string | null } | null;
};

export const Route = createFileRoute("/elencos")({
  head: () => ({
    meta: [
      { title: "Elencos — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Times e elencos da temporada atual da Liga Bola Presa." },
      { property: "og:title", content: "Elencos — Liga Bola Presa" },
      { property: "og:description", content: "Times e elencos da temporada atual." },
    ],
  }),
  component: ElencosPage,
});

// Ordem fixa das conferências (a mesma das abas da classificação).
const CONFERENCES = ["Donut", "Bad Boys"] as const;

function ElencosPage() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("teams")
        .select("id, name, abbreviation, slug, conference, primary_color, logo_url, gm:gms(id, full_name, nickname)")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (err) setError(err.message);
      else setTeams((data as unknown as TeamRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Agrupa por conferência; time sem conferência cai em "Outros" (só aparece se existir).
  const groups = useMemo(() => {
    const known = CONFERENCES.map((c) => ({ name: c as string, teams: teams.filter((t) => t.conference === c) }));
    const others = teams.filter((t) => !t.conference || !(CONFERENCES as readonly string[]).includes(t.conference));
    return [...known, { name: "Outros", teams: others }].filter((g) => g.teams.length > 0);
  }, [teams]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--court)]">Times & jogadores</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">Elencos</h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Escolha um time para ver o elenco.
      </p>

      <div className="mt-8">
        {loading && <p className="text-sm text-muted-foreground">Carregando times…</p>}
        {error && <p className="text-sm text-destructive">Erro ao carregar times: {error}</p>}
        {!loading && !error && teams.length === 0 && <EmptyTeams />}
        {!loading && !error && teams.length > 0 && (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.name}>
                <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
                  <h2 className="font-display text-xl tracking-tight">{g.name}</h2>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {g.teams.length} times
                  </span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.teams.map((team) => (
                    <li key={team.id}>
                      <TeamCard team={team} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamCard({ team }: { team: TeamRow }) {
  const primary = team.primary_color || "var(--chrome)";
  return (
    <Link
      to="/times/$slug"
      params={{ slug: team.slug }}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-[color:var(--court)] hover:bg-muted/40"
      style={{ borderLeftWidth: 4, borderLeftColor: primary }}
    >
      <div
        className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-white"
        style={{ background: primary }}
      >
        {team.logo_url ? (
          <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
        ) : (
          <span>{team.abbreviation}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{team.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{team.gm ? team.gm.full_name : "—"}</p>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50 transition-colors group-hover:text-[color:var(--court)]" />
    </Link>
  );
}

function EmptyTeams() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-display text-lg">Nenhum time cadastrado ainda</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Cadastre as franquias da liga pelo painel do Supabase (tabela <code>teams</code>).
      </p>
      <Link to="/gms" className="mt-4 inline-block text-sm font-medium text-[color:var(--court)] hover:underline">
        Ver GMs cadastrados →
      </Link>
    </div>
  );
}
