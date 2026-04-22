import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Calendário de jogos da temporada 2025/26." },
      { property: "og:title", content: "Calendário — Liga Bola Presa" },
      { property: "og:description", content: "Calendário de jogos da temporada 2025/26." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Temporada 2025/26"
      title="Calendário"
      description="Calendário completo da temporada será integrado a partir da planilha de calendário."
    />
  ),
});
