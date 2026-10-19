import { createFileRoute, redirect } from "@tanstack/react-router";

// Free Agents = leilão de free agents. Redireciona pra "/leilao" (a tela real).
export const Route = createFileRoute("/free-agents")({
  beforeLoad: () => {
    throw redirect({ to: "/leilao" });
  },
});
