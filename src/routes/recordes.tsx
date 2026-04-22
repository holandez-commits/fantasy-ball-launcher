import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/recordes")({
  head: () => ({
    meta: [
      { title: "Recordes — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Recordes históricos e da temporada atual da Liga Bola Presa." },
      { property: "og:title", content: "Recordes — Liga Bola Presa" },
      { property: "og:description", content: "Recordes históricos e da temporada." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Marcas históricas"
      title="Recordes"
      description="Pontos, rebotes, assistências, roubos, tocos e bolas de 3 — recordes históricos e da temporada atual."
    />
  ),
});
