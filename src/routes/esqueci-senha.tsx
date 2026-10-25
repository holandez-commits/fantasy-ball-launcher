import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/esqueci-senha")({
  head: () => ({
    meta: [
      { title: "Esqueci a senha — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EsqueciSenhaPage,
});

function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setSubmitting(false);

    if (error) {
      setError(
        error.status === 429
          ? "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo."
          : "Não foi possível enviar o e-mail agora. Tente novamente em instantes.",
      );
      return;
    }
    // E-mail inexistente também volta sem erro (o Supabase não revela quem tem conta),
    // então a mensagem é sempre a mesma.
    setSent(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Área restrita</p>
      <h1 className="mt-1 font-display text-3xl">Esqueci a senha</h1>

      {sent ? (
        <div className="mt-8 space-y-4">
          <Alert>
            <AlertDescription>
              Se esse e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.
              Confira também a caixa de spam. O link vale por tempo limitado.
            </AlertDescription>
          </Alert>
          <Link to="/login" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Informe o e-mail da sua conta e enviaremos um link para você criar uma nova senha.
          </p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar link"}
            </Button>
          </form>
          <Link to="/login" className="mt-6 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Voltar para o login
          </Link>
        </>
      )}
    </div>
  );
}
