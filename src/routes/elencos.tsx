import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "../integrations/supabase/client";
import { Shield } from "lucide-react";

type TeamRow = {
  id: string;
  name: string;
  abbreviation: string;
  slug: string;
  city: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  founded_year: number | null;
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
        .select(
          "id, name, abbreviation, slug, city, primary_color, secondary_color, logo_url, founded_year, gm:gms(id, full_name, nickname)",
        )
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--court)]">Times & jogadores</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">Elencos</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
        As franquias da liga e seus respectivos comandantes.
      </p>

      <div className="mt-10">
        {loading && <p className="text-sm text-muted-foreground">Carregando times…</p>}
        {error && <p className="text-sm text-destructive">Erro ao carregar times: {error}</p>}
        {!loading && !error && teams.length === 0 && <EmptyTeams />}
        {!loading && !error && teams.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => {
              const primary = team.primary_color || "var(--chrome)";
              return (
                <li key={team.id}>
                  <Link
                    to="/times/$slug"
                    params={{ slug: team.slug }}
                    className="block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-[color:var(--court)]"
                  >
                    <div className="h-2 w-full" style={{ background: primary }} />
                    <div className="p-5">
                      <div className="flex items-start gap-4">
                        <div
                          className="flex h-12 w-12 flex-none items-center justify-center rounded-lg text-sm font-display font-semibold text-white"
                          style={{ background: primary }}
                        >
                          {team.logo_url ? (
                            <img src={team.logo_url} alt={team.name} className="h-full w-full rounded-lg object-cover" />
                          ) : (
                            <span>{team.abbreviation}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-display text-lg leading-tight">{team.name}</h2>
                          <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                            {team.abbreviation}
                            {team.city ? ` · ${team.city}` : ""}
                          </p>
                        </div>
                      </div>
                      <dl className="mt-4 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-muted-foreground">GM</dt>
                          <dd className="truncate font-medium">
                            {team.gm ? team.gm.full_name : <span className="text-muted-foreground">—</span>}
                          </dd>
                        </div>
                        {team.founded_year && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Fundado em</dt>
                            <dd className="font-medium">{team.founded_year}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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
