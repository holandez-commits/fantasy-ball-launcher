import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RedefinirSenhaPage,
});

const MIN_LENGTH = 8;
/** Tempo para o Supabase processar o link do e-mail antes de considerá-lo inválido. */
const LINK_TIMEOUT_MS = 8000;

type Phase = "checking" | "ready" | "invalid" | "done";

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // O link do e-mail chega com a sessão de recuperação no endereço (#access_token=...&type=recovery).
  // O cliente do Supabase processa isso sozinho e dispara PASSWORD_RECOVERY. Só liberamos o
  // formulário nesse caso: quem já está logado e abre /redefinir-senha direto NÃO vê o
  // formulário (para trocar a senha logado existe a tela "Minha conta", que pede a senha atual).
  useEffect(() => {
    // Lê o endereço ANTES de tocar no cliente do Supabase (ele limpa o hash ao processar).
    const hash = window.location.hash;
    if (/error(_code|_description)?=/.test(hash)) {
      setPhase("invalid");
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setPhase("ready");
    });
    const timer = window.setTimeout(
      () => setPhase((p) => (p === "checking" ? "invalid" : p)),
      LINK_TIMEOUT_MS,
    );
    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (next.length < MIN_LENGTH) {
      setError(`A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (next !== confirm) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    if (updateError) {
      setSubmitting(false);
      const code = (updateError as { code?: string }).code;
      if (code === "same_password") {
        setError("A nova senha deve ser diferente da anterior.");
      } else if (code === "weak_password") {
        setError("Essa senha é fraca demais. Use uma mais longa e menos previsível.");
      } else {
        setError("Não foi possível salvar a nova senha. Peça um novo link e tente de novo.");
      }
      return;
    }

    // Encerra as outras sessões abertas com essa conta (se falhar, a troca já valeu).
    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch {
      /* ignora */
    }

    setSubmitting(false);
    setPhase("done");
    window.setTimeout(() => navigate({ to: "/", replace: true }), 2000);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Área restrita</p>
      <h1 className="mt-1 font-display text-3xl">Nova senha</h1>

      {phase === "checking" && (
        <p className="mt-8 text-sm text-muted-foreground">Validando o link…</p>
      )}

      {phase === "invalid" && (
        <div className="mt-8 space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              Este link é inválido ou expirou. Peça um novo link para redefinir a senha.
            </AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link to="/esqueci-senha">Pedir novo link</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Já está logado e quer trocar a senha? Use "Minha conta" no menu.
          </p>
        </div>
      )}

      {phase === "ready" && (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Mínimo de {MIN_LENGTH} caracteres.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </form>
      )}

      {phase === "done" && (
        <div className="mt-8 space-y-4">
          <Alert>
            <AlertDescription>
              Senha alterada. Você já está logado e será levado para a página inicial.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Ir agora</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
