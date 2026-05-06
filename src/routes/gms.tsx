import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "../integrations/supabase/client";
import { UserRound, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type GM = {
  id: string;
  full_name: string;
  nickname: string | null;
  bio: string | null;
  avatar_url: string | null;
  joined_year: number | null;
};

type TeamLite = {
  id: string;
  name: string;
  abbreviation: string;
  slug: string;
  gm_id: string | null;
  is_active: boolean;
};

export const Route = createFileRoute("/gms")({
  head: () => ({
    meta: [
      { title: "GMs — Liga Bola Presa de Fantasy" },
      { name: "description", content: "General Managers da Liga Bola Presa." },
      { property: "og:title", content: "GMs — Liga Bola Presa" },
      { property: "og:description", content: "General Managers da liga." },
    ],
  }),
  component: GMsPage,
});

function GMCard({ gm, team }: { gm: GM; team: TeamLite | undefined }) {
  return (
    <li className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-[color:var(--court)]">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {gm.avatar_url ? (
            <img src={gm.avatar_url} alt={gm.full_name} className="h-full w-full object-cover" />
          ) : (
            <UserRound className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight">{gm.full_name}</h2>
          {gm.nickname && (
            <p className="mt-0.5 text-sm text-muted-foreground">"{gm.nickname}"</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {gm.joined_year && <span>Desde {gm.joined_year}</span>}
            {team && (
              <Link
                to="/times/$slug"
                params={{ slug: team.slug }}
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-[color:var(--court)]"
              >
                {team.abbreviation} · {team.name}
              </Link>
            )}
          </div>
        </div>
      </div>
      {gm.bio && (
        <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{gm.bio}</p>
      )}
    </li>
  );
}

function GMsPage() {
  const [gms, setGms] = useState<GM[]>([]);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [gmsRes, teamsRes] = await Promise.all([
        supabase
          .from("gms")
          .select("id, full_name, nickname, bio, avatar_url, joined_year")
          .order("full_name"),
        supabase
          .from("teams")
          .select("id, name, abbreviation, slug, gm_id, is_active"),
      ]);
      if (cancelled) return;
      if (gmsRes.error) setError(gmsRes.error.message);
      else setGms(gmsRes.data ?? []);
      if (!teamsRes.error) setTeams(teamsRes.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const teamForGm = (gmId: string) => teams.find((t) => t.gm_id === gmId);

  // GM é ativo se tiver time ativo associado
  const activeGmIds = new Set(
    teams.filter((t) => t.is_active).map((t) => t.gm_id).filter(Boolean)
  );

  const activeGms   = gms.filter((gm) => activeGmIds.has(gm.id));
  const inactiveGms = gms.filter((gm) => !activeGmIds.has(gm.id));

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--court)]">Comandantes</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">General Managers</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Quem comanda as franquias da Liga Bola Presa.
      </p>

      <div className="mt-10">
        {loading && <p className="text-sm text-muted-foreground">Carregando GMs…</p>}
        {error && <p className="text-sm text-destructive">Erro ao carregar GMs: {error}</p>}

        {!loading && !error && (
          <>
            {/* GMs ativos */}
            {activeGms.length > 0 && (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeGms.map((gm) => (
                  <GMCard key={gm.id} gm={gm} team={teamForGm(gm.id)} />
                ))}
              </ul>
            )}

            {/* GMs inativos — colapsável */}
            {inactiveGms.length > 0 && (
              <div className="mt-10">
                <button
                  type="button"
                  onClick={() => setShowInactive((v) => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showInactive && "rotate-180")} />
                  Ex-GMs ({inactiveGms.length})
                </button>

                {showInactive && (
                  <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-60">
                    {inactiveGms.map((gm) => (
                      <GMCard key={gm.id} gm={gm} team={teamForGm(gm.id)} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyGMs() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <p className="font-display text-lg">Nenhum GM cadastrado ainda</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Cadastre os comandantes da liga pelo painel do Supabase (tabela <code>gms</code>).
      </p>
    </div>
  );
}
