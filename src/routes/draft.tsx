import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/draft")({
  head: () => ({
    meta: [
      { title: "Draft — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Draft da temporada da Liga Bola Presa." },
      { property: "og:title", content: "Draft — Liga Bola Presa" },
      { property: "og:description", content: "Draft da temporada." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Pré-temporada"
      title="Draft"
      description="Acompanhe as escolhas do draft e o histórico de picks da liga."
    />
  ),
});
