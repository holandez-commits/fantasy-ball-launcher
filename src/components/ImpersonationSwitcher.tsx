import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * TEMPORÁRIO (testes finais): deixa um admin "agir como" qualquer time.
 * A lógica real está no banco — current_team_id()/current_gm_id() respeitam a
 * linha em admin_impersonation quando quem chama é admin. Aqui é só a UI:
 * escolher um time chama impersonate_team(); "Eu mesmo" chama stop_impersonating().
 *
 * Para remover tudo quando os testes acabarem: apagar este arquivo + a referência
 * no AppSidebar/__root e reverter as 2 funções no banco (ver ESTADO_PROJETO.md).
 */

type TeamRow = { id: string; name: string; slug: string };

function rpcImpersonate(teamId: string) {
  return (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: unknown }>
  ).call(supabase, "impersonate_team", { _team_id: teamId });
}

function rpcStop() {
  return (
    supabase.rpc as unknown as (fn: string) => Promise<{ error: unknown }>
  ).call(supabase, "stop_impersonating");
}

function reload() {
  if (typeof window !== "undefined") window.location.reload();
}

export function ImpersonationSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { isAdmin, loading, impersonatingTeamId } = useAuth();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void supabase
      .from("teams")
      .select("id,name,slug")
      .eq("is_active", true)
      .order("name")
      .then((res) => {
        if (!cancelled) setTeams((res.data ?? []) as TeamRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (loading || !isAdmin) return null;

  const active = !!impersonatingTeamId;

  async function onChange(value: string) {
    setBusy(true);
    try {
      if (value) await rpcImpersonate(value);
      else await rpcStop();
      reload(); // garante que todas as queries re-rodem com a nova identidade
    } catch {
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <div
        className="my-2 flex justify-center"
        title={active ? "Impersonando um time (expanda o menu)" : "Testar como…"}
      >
        <UserCog
          className={cn(
            "h-4 w-4",
            active ? "text-[color:var(--court-bright)]" : "text-[color:var(--chrome-muted)]",
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-2 mb-3 rounded-md border p-2",
        active
          ? "border-[color:var(--court-bright)] bg-[color:var(--court-bright)]/10"
          : "border-[color:var(--chrome-border)]",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--chrome-muted)]">
        <UserCog className="h-3.5 w-3.5" /> Testar como
      </div>
      <select
        disabled={busy}
        value={impersonatingTeamId ?? ""}
        onChange={(e) => void onChange(e.target.value)}
        className="w-full rounded border border-[color:var(--chrome-border)] bg-[color:var(--chrome)] px-2 py-1.5 text-sm text-[color:var(--chrome-foreground)] disabled:opacity-60"
      >
        <option value="">— Eu mesmo (normal) —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {active && (
        <p className="mt-1.5 text-[11px] text-[color:var(--court-bright)]">
          Agindo como outro time. Selecione “Eu mesmo” para voltar.
        </p>
      )}
    </div>
  );
}

/**
 * Faixa de alerta no topo de todas as páginas enquanto um admin está impersonando.
 */
export function ImpersonationBanner() {
  const { impersonatingTeamId, teamName, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  if (loading || !impersonatingTeamId) return null;

  async function stop() {
    setBusy(true);
    try {
      await rpcStop();
      reload();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-[color:var(--court-bright)] px-4 py-1.5 text-center text-xs font-medium text-black">
      <span>
        ⚠️ Modo teste — agindo como <strong>{teamName ?? "outro time"}</strong>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void stop()}
        className="rounded bg-black/20 px-2 py-0.5 font-semibold hover:bg-black/30 disabled:opacity-60"
      >
        Voltar ao normal
      </button>
    </div>
  );
}
