import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/elencos")({
  head: () => ({
    meta: [
      { title: "Elencos — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Times e jogadores da temporada atual da Liga Bola Presa." },
      { property: "og:title", content: "Elencos — Liga Bola Presa" },
      { property: "og:description", content: "Times e jogadores da temporada atual." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Times & jogadores"
      title="Elencos"
      description="Em breve cada franquia terá sua página com elenco, jogadores titulares e história."
    />
  ),
});
