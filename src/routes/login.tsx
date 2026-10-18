import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    // só aceita caminhos internos, evita open redirect
    redirect:
      typeof search.redirect === "string" &&
      search.redirect.startsWith("/") &&
      !search.redirect.startsWith("//")
        ? search.redirect
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Entrar — Liga Bola Presa de Fantasy" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  // Já logado (ou login concluído): segue pra rota pretendida.
  useEffect(() => {
    if (!loading && user) navigate({ to: redirect ?? "/", replace: true });
  }, [loading, user, redirect, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (error) {
      setError(
        error.status === 400
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar agora. Tente novamente.",
      );
    }
  }

  // Magic link: envia um link de acesso por e-mail. O link volta pra /login,
  // onde a sessão é detectada na URL (detectSessionInUrl) e o efeito acima
  // redireciona. shouldCreateUser:false => só e-mails já cadastrados entram.
  async function sendMagicLink() {
    const addr = email.trim();
    if (!addr) {
      setError("Informe o e-mail para receber o link de acesso.");
      return;
    }
    setError(null);
    setMagicSent(false);
    setSubmitting(true);
    const emailRedirectTo =
      `${window.location.origin}/login` +
      (redirect ? `?redirect=${encodeURIComponent(redirect)}` : "");
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo, shouldCreateUser: false },
    });
    setSubmitting(false);
    if (error) {
      setError("Não foi possível enviar o link agora. Confira o e-mail e tente de novo.");
    } else {
      setMagicSent(true);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Área restrita</p>
      <h1 className="mt-1 font-display text-3xl">Entrar</h1>
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
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Entrando..." : "Entrar"}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={submitting}
        onClick={sendMagicLink}
      >
        Receber link de acesso por e-mail
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Informe seu e-mail acima e enviamos um link que entra sem senha.
      </p>

      {magicSent && (
        <Alert className="mt-4">
          <AlertDescription>
            Se este e-mail tiver conta na liga, enviamos um link de acesso. Abra o e-mail e clique
            para entrar.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
