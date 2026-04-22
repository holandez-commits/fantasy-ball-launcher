import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/medias")({
  head: () => ({
    meta: [
      { title: "Médias — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Médias dos jogadores na Liga Bola Presa." },
      { property: "og:title", content: "Médias — Liga Bola Presa" },
      { property: "og:description", content: "Médias dos jogadores da temporada." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Estatísticas"
      title="Médias"
      description="Médias por jogador serão carregadas da sua planilha de médias."
    />
  ),
});
