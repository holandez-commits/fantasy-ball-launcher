import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { prepararFn, callRpc } from "@/lib/finalizar";
import type { PrepareResult } from "@/lib/confronto-server";

type Props = {
  gameId: string;
  status: string; // 'scheduled' | 'final'
  homeName: string;
  awayName: string;
  hasPlanilha: boolean;
  onChanged: () => void | Promise<void>;
};

/**
 * Botão de admin na tela do confronto: "Fechar partida" (grava a planilha no banco
 * e marca como final) ou "Reabrir partida" quando já está final. Não aparece para
 * quem não é admin. A segurança de verdade está nas RPCs (has_role('admin')).
 */
export function FinalizarPartida({ gameId, status, homeName, awayName, hasPlanilha, onChanged }: Props) {
  const { isAdmin, loading } = useAuth();
  const isFinal = status === "final";

  const [open, setOpen] = useState(false);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !isAdmin) return null;
  if (!isFinal && !hasPlanilha) return null;

  async function abrir() {
    setOpen(true);
    setError(null);
    setPrep(null);
    if (isFinal) return;
    setLoadingPrep(true);
    try {
      setPrep(await prepararFn({ data: gameId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não consegui ler a planilha.");
    } finally {
      setLoadingPrep(false);
    }
  }

  async function confirmar() {
    setSaving(true);
    setError(null);
    let err: string | null = null;
    if (isFinal) {
      const { error: e } = await callRpc("reabrir_confronto", { _game_id: gameId });
      err = e?.message ?? null;
    } else if (prep && prep.ok) {
      const { error: e } = await callRpc("finalizar_confronto", {
        _game_id: gameId,
        _payload: prep.build.payload,
      });
      err = e?.message ?? null;
    }
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    await onChanged();
  }

  const unmatched = prep && prep.ok ? prep.build.unmatched : [];
  const pending = prep && prep.ok ? prep.anyPending : false;
  const podeGravar = !!prep && prep.ok && unmatched.length === 0;

  return (
    <div className="mt-3 flex justify-end">
      <Button size="sm" variant={isFinal ? "ghost" : "outline"} onClick={abrir}>
        {isFinal ? "Reabrir partida" : "Fechar partida"}
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isFinal ? "Reabrir partida" : "Fechar partida"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {isFinal ? (
                  <p>
                    Reabrir <b>{homeName} × {awayName}</b>? A partida volta a ficar &quot;a jogar&quot; e sai da
                    classificação até ser fechada de novo.
                  </p>
                ) : loadingPrep ? (
                  <p>Lendo a planilha…</p>
                ) : !prep ? (
                  error ? null : <p>Preparando…</p>
                ) : !prep.ok ? (
                  <p className="text-destructive">
                    {prep.reason === "sem_planilha"
                      ? "Esta partida não tem planilha vinculada."
                      : (prep.message ?? "Não consegui ler a planilha.")}
                  </p>
                ) : (
                  <>
                    <p>
                      Vou gravar o resultado de <b>{homeName} × {awayName}</b>:
                    </p>
                    <p className="font-display text-2xl tabular-nums text-foreground">
                      {prep.homeScore} × {prep.awayScore}
                      {prep.tiedCategories > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({prep.tiedCategories} categoria(s) empatada(s))
                        </span>
                      )}
                    </p>
                    {unmatched.length > 0 && (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                        Nomes sem cadastro (corrija na planilha e tente de novo):{" "}
                        {unmatched.map((u) => u.name).join(", ")}
                      </p>
                    )}
                    {pending && unmatched.length === 0 && (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                        Ainda há jogadores sem estatística. Se fechar agora, eles ficam sem stats nesta partida.
                      </p>
                    )}
                  </>
                )}
                {error && <p className="text-destructive">{error}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <Button onClick={confirmar} disabled={saving || (!isFinal && (loadingPrep || !podeGravar))}>
              {saving
                ? "Gravando…"
                : isFinal
                  ? "Reabrir"
                  : pending
                    ? "Fechar assim mesmo"
                    : "Fechar partida"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
