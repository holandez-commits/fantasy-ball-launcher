import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/consolidar-lock")({
  head: () => ({
    meta: [
      { title: "Consolidar escalações — Admin — Liga Bola Presa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsolidarLockPage,
});

type SeasonOpt = { id: string; label: string; start_year: number; is_current: boolean };
type LockRow = { season_id: string; week_number: number; locks_at: string };

// Tipagem frouxa: consolidar_lock e roster_locks não estão no types.ts (defasado).
const callRpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);

function formatBrt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function friendlyError(message: string) {
  if (message.toLowerCase().includes("só é permitida após") || message.toLowerCase().includes("so e permitida apos"))
    return `${message} Aguarde o prazo da semana vencer e tente de novo.`;
  return message;
}

function ConsolidarLockPage() {
  const { ready, forbidden } = useRequireAuth({ role: "admin" });

  const [seasons, setSeasons] = useState<SeasonOpt[]>([]);
  const [locks, setLocks] = useState<LockRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [seasonId, setSeasonId] = useState("");
  const [week, setWeek] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [sRes, lRes] = await Promise.all([
        supabase
          .from("seasons")
          .select("id, label, start_year, is_current")
          .order("start_year", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as unknown as { from: (t: string) => any })
          .from("roster_locks")
          .select("season_id, week_number, locks_at")
          .order("week_number", { ascending: true }),
      ]);
      if (sRes.error || lRes.error) {
        setLoadError("Não foi possível carregar temporadas e semanas fechadas.");
        return;
      }
      const list = ((sRes.data ?? []) as unknown as SeasonOpt[]).slice();
      list.sort((a, b) => Number(b.is_current) - Number(a.is_current) || b.start_year - a.start_year);
      setSeasons(list);
      setSeasonId((cur) => cur || list[0]?.id || "");
      setLocks((lRes.data ?? []) as LockRow[]);
    })();
  }, [ready]);

  const season = useMemo(() => seasons.find((s) => s.id === seasonId), [seasons, seasonId]);
  const seasonLocks = useMemo(() => locks.filter((l) => l.season_id === seasonId), [locks, seasonId]);
  const lock = useMemo(
    () => seasonLocks.find((l) => String(l.week_number) === week),
    [seasonLocks, week],
  );
  const expired = !!lock && Date.now() >= new Date(lock.locks_at).getTime();
  const canSubmit = !!season && !!lock && !submitting;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setResult(null);
    setConfirmOpen(true);
  }

  async function confirm() {
    if (!season || !lock) return;
    setSubmitting(true);
    const { data, error } = await callRpc("consolidar_lock", {
      _season_id: season.id,
      _week: lock.week_number,
    });
    setSubmitting(false);
    setConfirmOpen(false);
    if (error) {
      setResult({ ok: false, message: friendlyError(error.message) });
    } else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Escalações consolidadas." });
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-3xl">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta área é restrita a administradores da liga.
        </p>
      </div>
    );
  }
  if (!ready) return null;

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Admin</p>
      <h1 className="mt-1 font-display text-3xl">Consolidar escalações</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Depois do prazo, copia a última escalação de cada time que não escalou a semana. Só funciona
        depois que o prazo da semana vence; jogadores fora do retrato viram buracos.
      </p>

      {loadError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="season">Temporada</Label>
          <Select
            value={seasonId}
            onValueChange={(v) => {
              setSeasonId(v);
              setWeek("");
              setResult(null);
            }}
          >
            <SelectTrigger id="season">
              <SelectValue placeholder="Selecione a temporada" />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                  {s.is_current ? " (atual)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="week">Semana fechada</Label>
          <Select
            value={week}
            onValueChange={(v) => {
              setWeek(v);
              setResult(null);
            }}
            disabled={seasonLocks.length === 0}
          >
            <SelectTrigger id="week">
              <SelectValue
                placeholder={
                  seasonLocks.length === 0 ? "Nenhuma semana fechada nesta temporada" : "Selecione a semana"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {seasonLocks.map((l) => {
                const venceu = Date.now() >= new Date(l.locks_at).getTime();
                return (
                  <SelectItem key={l.week_number} value={String(l.week_number)}>
                    Semana {l.week_number} — prazo {formatBrt(l.locks_at)} {venceu ? "(vencido)" : "(em aberto)"}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Horários em Brasília.</p>
        </div>

        {lock && !expired && (
          <Alert variant="destructive">
            <AlertTitle>Prazo ainda não venceu</AlertTitle>
            <AlertDescription>
              O prazo dessa semana vence em {formatBrt(lock.locks_at)} (Brasília). A consolidação vai
              falhar até lá.
            </AlertDescription>
          </Alert>
        )}
        {lock && expired && (
          <Alert>
            <AlertDescription>
              Prazo vencido em {formatBrt(lock.locks_at)} (Brasília): pode consolidar.
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={!canSubmit}>
          Consolidar escalações
        </Button>
      </form>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Escalações consolidadas" : "Não foi possível consolidar"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar consolidação</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai criar escalações por cópia pra todos os times que não escalaram na semana{" "}
              {lock?.week_number} da {season?.label}, usando a última escalação de cada um. Ação com
              efeito no banco.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button onClick={confirm} disabled={submitting}>
              {submitting ? "Consolidando..." : "Confirmar e consolidar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
