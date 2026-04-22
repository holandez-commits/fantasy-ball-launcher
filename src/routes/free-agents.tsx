import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/free-agents")({
  head: () => ({
    meta: [
      { title: "Free Agents — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Mercado de jogadores livres da Liga Bola Presa." },
      { property: "og:title", content: "Free Agents — Liga Bola Presa" },
      { property: "og:description", content: "Mercado de jogadores livres." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Mercado"
      title="Free Agents"
      description="Lista de jogadores disponíveis no mercado e movimentações recentes."
    />
  ),
});
