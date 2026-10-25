import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  /** true até a sessão E os roles/ids terem sido resolvidos */
  loading: boolean;
  isAdmin: boolean;
  isGm: boolean;
  gmId: string | null;
  teamId: string | null;
  /** slug do time ativo (ou do time impersonado, se for admin impersonando) */
  teamSlug: string | null;
  /** nome do time ativo/impersonado (para banners) */
  teamName: string | null;
  /**
   * TEMPORÁRIO (testes finais): se um admin está "agindo como" um time, este é
   * o id do time impersonado; null quando o admin está no modo normal.
   * Quando preenchido, teamId/teamSlug/teamName/gmId já refletem o time impersonado.
   */
  impersonatingTeamId: string | null;
  signOut: () => Promise<void>;
};

type Profile = {
  roles: string[];
  gmId: string | null;
  teamId: string | null;
  teamSlug: string | null;
  teamName: string | null;
  impersonatingTeamId: string | null;
};
const EMPTY_PROFILE: Profile = {
  roles: [],
  gmId: null,
  teamId: null,
  teamSlug: null,
  teamName: null,
  impersonatingTeamId: null,
};

const AuthContext = createContext<AuthState | null>(null);

// As RPCs e o valor 'gm' do enum existem só no banco vivo (types.ts está defasado),
// por isso o acesso é tipado de forma frouxa.
function callRpc(fn: string) {
  return (
    supabase.rpc as unknown as (fn: string) => Promise<{ data: string | null; error: unknown }>
  ).call(supabase, fn);
}

async function loadProfile(userId: string): Promise<Profile> {
  const [rolesRes, gmRes, teamRes, impRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    callRpc("current_gm_id"),
    callRpc("current_team_id"),
    callRpc("current_impersonation"),
  ]);
  const roles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
  const teamId = teamRes.error ? null : (teamRes.data ?? null);
  let teamSlug: string | null = null;
  let teamName: string | null = null;
  if (teamId) {
    const tRes = await supabase.from("teams").select("slug,name").eq("id", teamId).maybeSingle();
    const t = tRes.data as { slug: string; name: string } | null;
    teamSlug = t?.slug ?? null;
    teamName = t?.name ?? null;
  }
  return {
    roles,
    gmId: gmRes.error ? null : (gmRes.data ?? null),
    teamId,
    teamSlug,
    teamName,
    impersonatingTeamId: impRes.error ? null : (impRes.data ?? null),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Sessão: só roda no cliente (localStorage), então SSR e hidratação começam com loading=true.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Perfil (roles + gm/team) em efeito separado, sem chamadas dentro do callback do auth.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setProfile(EMPTY_PROFILE);
      setProfileUserId(null);
      return;
    }
    let cancelled = false;
    loadProfile(userId)
      .catch(() => EMPTY_PROFILE)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setProfileUserId(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = !sessionReady || (userId !== null && profileUserId !== userId);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    isAdmin: profile.roles.includes("admin"),
    isGm: profile.roles.includes("gm"),
    gmId: profile.gmId,
    teamId: profile.teamId,
    teamSlug: profile.teamSlug,
    teamName: profile.teamName,
    impersonatingTeamId: profile.impersonatingTeamId,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

/**
 * Guard reutilizável. Chame no componente de uma rota protegida:
 *
 *   const { ready, forbidden } = useRequireAuth();               // qualquer logado
 *   const { ready, forbidden } = useRequireAuth({ role: "admin" });
 *   if (!ready) return null;                                     // ou um skeleton
 *
 * Nunca redireciona no SSR/hidratação: só depois que `loading` resolve como deslogado.
 * Logado sem o role exigido: `forbidden` fica true (sem redirecionar).
 */
export function useRequireAuth(opts: { role?: "admin" | "gm" } = {}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    if (auth.loading || auth.user) return;
    // Durante a transição para /login a página protegida ainda está montada e já enxerga
    // o novo pathname; sem esta guarda ela redirecionava para /login de novo, em loop
    // (/login?redirect=%2Flogin%3Fredirect=...).
    if (pathname === "/login" || pathname.startsWith("/login/")) return;
    navigate({ to: "/login", search: { redirect: pathname + searchStr }, replace: true });
  }, [auth.loading, auth.user, navigate, pathname, searchStr]);

  const hasRole = !opts.role || auth.isAdmin || (opts.role === "gm" && auth.isGm);
  return {
    ...auth,
    ready: !auth.loading && !!auth.user && hasRole,
    forbidden: !auth.loading && !!auth.user && !hasRole,
  };
}
