import { createFileRoute, redirect } from "@tanstack/react-router";

// Nome antigo da tela: virou "Classificados Bola Presa" (/classificados). Mantido para links de avisos antigos.
export const Route = createFileRoute("/trade-block")({
  beforeLoad: () => {
    throw redirect({ to: "/classificados" });
  },
});
