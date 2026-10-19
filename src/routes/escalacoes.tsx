import { createFileRoute, redirect } from "@tanstack/react-router";

// Tela aposentada: "/escalacoes" (placeholder) foi descontinuada.
// A escalação do GM vive em "/escalar". Redireciona pra home para não
// deixar link morto (o item sumiu do menu).
export const Route = createFileRoute("/escalacoes")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
