import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/regras")({
  head: () => ({
    meta: [
      { title: "Regras — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Regras, divisões, conferências e premiação da Liga Bola Presa." },
      { property: "og:title", content: "Regras — Liga Bola Presa" },
      { property: "og:description", content: "Regras, divisões, conferências e premiação." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Manual da liga"
      title="Regras"
      description="Regras oficiais, divisões e conferências, premiação e rookie scale serão centralizados aqui."
    />
  ),
});
