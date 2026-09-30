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
  signOut: () => Promise<void>;
};

type Profile = { roles: string[]; gmId: string | null; teamId: string | null };
const EMPTY_PROFILE: Profile = { roles: [], gmId: null, teamId: null };

const AuthContext = createContext<AuthState | null>(null);

// As RPCs e o valor 'gm' do enum existem só no banco vivo (types.ts está defasado),
// por isso o acesso é tipado de forma frouxa.
function callRpc(fn: string) {
  return (
    supabase.rpc as unknown as (fn: string) => Promise<{ data: string | null; error: unknown }>
  ).call(supabase, fn);
}

async function loadProfile(userId: string): Promise<Profile> {
  const [rolesRes, gmRes, teamRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    callRpc("current_gm_id"),
    callRpc("current_team_id"),
  ]);
  return {
    roles: ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role),
    gmId: gmRes.error ? null : (gmRes.data ?? null),
    teamId: teamRes.error ? null : (teamRes.data ?? null),
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
    navigate({ to: "/login", search: { redirect: pathname + searchStr }, replace: true });
  }, [auth.loading, auth.user, navigate, pathname, searchStr]);

  const hasRole = !opts.role || auth.isAdmin || (opts.role === "gm" && auth.isGm);
  return {
    ...auth,
    ready: !auth.loading && !!auth.user && hasRole,
    forbidden: !auth.loading && !!auth.user && !hasRole,
  };
}
