import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/admin/fechar-semana")({
  head: () => ({
    meta: [
      { title: "Fechar semana — Admin — Liga Bola Presa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FecharSemanaPage,
});

type SeasonOpt = { id: string; label: string; start_year: number; total_weeks: number; is_current: boolean };
type WeekEntry = { season_id: string; week_number: number };

// Brasília não tem horário de verão desde 2019: offset fixo -03:00.
const BRT_OFFSET = "-03:00";

// Tipagem frouxa: fechar_semana não está no types.ts (defasado).
const callRpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);

function formatBrt(local: string) {
  // local = "YYYY-MM-DDTHH:mm"
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y} às ${t} (horário de Brasília)`;
}

function FecharSemanaPage() {
  const { ready, forbidden } = useRequireAuth({ role: "admin" });

  const [seasons, setSeasons] = useState<SeasonOpt[]>([]);
  const [weeksIndex, setWeeksIndex] = useState<WeekEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [seasonId, setSeasonId] = useState("");
  const [week, setWeek] = useState("");
  const [locksAt, setLocksAt] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [sRes, wRes] = await Promise.all([
        supabase
          .from("seasons")
          .select("id, label, start_year, total_weeks, is_current")
          .order("start_year", { ascending: false }),
        callRpc("get_weeks_index"),
      ]);
      if (sRes.error) {
        setLoadError("Não foi possível carregar as temporadas.");
        return;
      }
      const list = ((sRes.data ?? []) as unknown as SeasonOpt[]).slice();
      list.sort((a, b) => Number(b.is_current) - Number(a.is_current) || b.start_year - a.start_year);
      setSeasons(list);
      setSeasonId((cur) => cur || list[0]?.id || "");
      setWeeksIndex((wRes.data ?? []) as WeekEntry[]);
    })();
  }, [ready]);

  const season = useMemo(() => seasons.find((s) => s.id === seasonId), [seasons, seasonId]);
  const suggestedWeeks = useMemo(
    () =>
      weeksIndex
        .filter((w) => w.season_id === seasonId)
        .map((w) => w.week_number)
        .sort((a, b) => a - b),
    [weeksIndex, seasonId],
  );

  const weekNum = Number(week);
  const weekValid =
    !!season && Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= season.total_weeks;
  const canSubmit = !!season && weekValid && !!locksAt && !submitting;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setResult(null);
    setConfirmOpen(true);
  }

  async function confirm() {
    if (!season) return;
    setSubmitting(true);
    const { data, error } = await callRpc("fechar_semana", {
      _season_id: season.id,
      _week: weekNum,
      _season_int: season.start_year,
      _locks_at: `${locksAt}:00${BRT_OFFSET}`,
    });
    setSubmitting(false);
    setConfirmOpen(false);
    if (error) {
      setResult({ ok: false, message: error.message });
    } else {
      setResult({ ok: true, message: typeof data === "string" ? data : "Semana fechada." });
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
      <h1 className="mt-1 font-display text-3xl">Fechar semana</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Congela o elenco atual dos times e define o prazo de travamento das escalações da semana.
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
          <Label htmlFor="week">Semana{season ? ` (1 a ${season.total_weeks})` : ""}</Label>
          <Input
            id="week"
            type="number"
            inputMode="numeric"
            min={1}
            max={season?.total_weeks}
            step={1}
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            required
          />
          {week !== "" && !weekValid && season && (
            <p className="text-xs text-destructive">
              Informe um número inteiro entre 1 e {season.total_weeks}.
            </p>
          )}
          {suggestedWeeks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">Já existem no índice:</span>
              {suggestedWeeks.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setWeek(String(n))}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="locks">Prazo do lock (horário de Brasília)</Label>
          <Input
            id="locks"
            type="datetime-local"
            value={locksAt}
            onChange={(e) => setLocksAt(e.target.value)}
            required
          />
        </div>

        <Button type="submit" disabled={!canSubmit}>
          Fechar semana
        </Button>
      </form>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertTitle>{result.ok ? "Semana fechada" : "Não foi possível fechar a semana"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar fechamento da semana</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai congelar o elenco atual de todos os times e travar as escalações da semana{" "}
              {weekNum} da {season?.label} no prazo {locksAt ? formatBrt(locksAt) : ""}. A ação
              grava no banco e não deve ser repetida sem necessidade.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button onClick={confirm} disabled={submitting}>
              {submitting ? "Fechando..." : "Confirmar e fechar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
