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
      { title: "Preencher escalações pendentes — Admin — Liga Bola Presa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsolidarLockPage,
});

type SeasonOpt = { id: string; label: string; start_year: number; is_current: boolean };
type LockRow = { season_id: string; week_number: number; locks_at: string };
type TeamResult = {
  team: string;
  jogos: number;
  copiados: number;
  buracos: number;
  sem_modelo: boolean;
  detalhe: { jogador: string; posicao: string | null; slot: string }[];
};
type Plan = { dry: boolean; teams: TeamResult[] };

function holesText(t: TeamResult) {
  const uniq = [...new Set(t.detalhe.map((d) => `${d.jogador}${d.posicao ? ` (${d.posicao})` : ""}`))];
  return uniq.join(", ");
}

/** Lista por time: quem será/foi preenchido, onde há buraco e quem não tem escalação anterior. */
function PlanView({ plan, done }: { plan: Plan; done: boolean }) {
  const filled = plan.teams.filter((t) => !t.sem_modelo);
  const semModelo = plan.teams.filter((t) => t.sem_modelo);
  const comBuraco = filled.filter((t) => t.buracos > 0);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">
          {done ? "Times copiados" : "Times que serão preenchidos"} ({filled.length})
        </p>
        {filled.length === 0 ? (
          <p className="text-muted-foreground">Nenhum.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {filled.map((t) => (
              <li key={t.team}>
                {t.team}{" "}
                <span className="text-muted-foreground">
                  — {t.jogos} {t.jogos === 1 ? "jogo" : "jogos"}, {t.copiados} slots
                  {t.buracos > 0 ? `, ${t.buracos} ${t.buracos === 1 ? "buraco" : "buracos"}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="font-medium">{done ? "Buracos" : "Buracos previstos"}</p>
        {comBuraco.length === 0 ? (
          <p className="text-muted-foreground">Nenhum buraco.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {comBuraco.map((t) => (
              <li key={t.team}>
                <span className="font-medium">{t.team}</span>{" "}
                <span className="text-muted-foreground">— jogador(es) fora do elenco ao vivo: {holesText(t)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {semModelo.length > 0 && (
        <div>
          <p className="font-medium">Sem escalação anterior (ficam vazios) ({semModelo.length})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {semModelo.map((t) => (
              <li key={t.team}>
                {t.team}{" "}
                <span className="text-muted-foreground">
                  — {t.jogos} {t.jogos === 1 ? "jogo" : "jogos"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Tipagem frouxa: consolidar_escalacoes_pendentes e roster_locks não estão no types.ts (defasado).
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
  const [preview, setPreview] = useState<Plan | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [report, setReport] = useState<Plan | null>(null);

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

  // Prévia (simulação que não grava): quais times serão preenchidos e onde haverá buraco.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!season || !lock || !expired) return;
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      const { data, error } = await callRpc("consolidar_escalacoes_pendentes_v2", {
        _season_id: season.id,
        _week: lock.week_number,
        _dry: true,
      });
      if (cancelled) return;
      setPreviewLoading(false);
      if (error) setPreviewError(friendlyError(error.message));
      else setPreview(data as Plan);
    })();
    return () => {
      cancelled = true;
    };
  }, [season, lock, expired]);

  const nothingPending = !!preview && preview.teams.length === 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setResult(null);
    setConfirmOpen(true);
  }

  async function confirm() {
    if (!season || !lock) return;
    setSubmitting(true);
    const { data, error } = await callRpc("consolidar_escalacoes_pendentes_v2", {
      _season_id: season.id,
      _week: lock.week_number,
      _dry: false,
    });
    setSubmitting(false);
    setConfirmOpen(false);
    if (error) {
      setReport(null);
      setResult({ ok: false, message: friendlyError(error.message) });
    } else {
      const plan = data as Plan;
      setReport(plan);
      setPreview({ dry: true, teams: [] });
      setResult({
        ok: true,
        message:
          plan.teams.length === 0
            ? "Nenhum time pendente nesta semana."
            : `${plan.teams.filter((t) => !t.sem_modelo).length} time(s) preenchido(s) por cópia.`,
      });
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
      <h1 className="mt-1 font-display text-3xl">Preencher escalações pendentes</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Depois do prazo, preenche quem não escalou copiando a última escalação de cada time. Só
        funciona depois que o prazo da semana vence; jogadores que saíram do elenco viram buracos.
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
              setReport(null);
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
              setReport(null);
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

        {lock && expired && !report && (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Prévia (nada foi gravado)</p>
            {previewLoading && <p className="text-sm text-muted-foreground">Calculando…</p>}
            {previewError && <p className="text-sm text-destructive">{previewError}</p>}
            {preview && (nothingPending ? (
              <p className="text-sm text-muted-foreground">Nenhum time pendente: todos já têm escalação nesta semana.</p>
            ) : (
              <PlanView plan={preview} done={false} />
            ))}
          </div>
        )}

        <Button type="submit" disabled={!canSubmit || previewLoading || nothingPending}>
          Preencher escalações pendentes
        </Button>
      </form>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Escalações preenchidas" : "Não foi possível preencher"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {report && report.teams.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <PlanView plan={report} done />
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar preenchimento</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai criar escalações por cópia pra todos os times que não escalaram na semana{" "}
              {lock?.week_number} da {season?.label}, usando a última escalação de cada um. Ação com
              efeito no banco.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && preview.teams.length > 0 && <PlanView plan={preview} done={false} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button onClick={confirm} disabled={submitting}>
              {submitting ? "Preenchendo..." : "Confirmar e preencher"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
