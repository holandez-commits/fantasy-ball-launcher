import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/minha-conta")({
  head: () => ({
    meta: [{ title: "Minha conta — Liga Bola Presa de Fantasy" }],
  }),
  component: MinhaContaPage,
});

const MIN_LENGTH = 8;

function MinhaContaPage() {
  const { ready, user } = useRequireAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!ready || !user) return null;
  const email = user.email ?? "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (next.length < MIN_LENGTH) {
      setError(`A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (next !== confirm) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    if (next === current) {
      setError("A nova senha deve ser diferente da atual.");
      return;
    }

    setSubmitting(true);

    // 1) Confere a senha atual (e renova a sessão, o que o Supabase exige em
    //    alguns projetos para trocar a senha: "secure password change").
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (signInError) {
      setSubmitting(false);
      setError(
        signInError.status === 400
          ? "A senha atual está incorreta."
          : "Não foi possível verificar a senha atual. Tente novamente.",
      );
      return;
    }

    // 2) Troca a senha. Sempre a do usuário real (a impersonação de admin é só
    //    no banco; a sessão do Supabase continua sendo a do admin).
    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    if (updateError) {
      setSubmitting(false);
      const code = (updateError as { code?: string }).code;
      if (code === "same_password") {
        setError("A nova senha deve ser diferente da atual.");
      } else if (code === "weak_password") {
        setError("Essa senha é fraca demais. Use uma mais longa e menos previsível.");
      } else {
        setError("Não foi possível trocar a senha agora. Tente novamente.");
      }
      return;
    }

    // 3) Encerra as outras sessões abertas (outros aparelhos/navegadores).
    //    Se falhar, a troca já valeu; não vale incomodar o usuário por isso.
    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch {
      /* ignora */
    }

    setSubmitting(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setSuccess(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Minha conta</p>
      <h1 className="mt-1 font-display text-3xl">Trocar senha</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Conta: <span className="font-medium text-foreground">{email}</span>
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="current-password">Senha atual</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
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
        {success && (
          <Alert>
            <AlertDescription>
              Senha alterada. Os outros aparelhos em que você estava logado foram desconectados.
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </form>
    </div>
  );
}
