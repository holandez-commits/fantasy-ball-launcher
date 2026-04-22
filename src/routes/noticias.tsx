import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/noticias")({
  head: () => ({
    meta: [
      { title: "Notícias — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Narrativas dos jogos e notícias da Liga Bola Presa." },
      { property: "og:title", content: "Notícias — Liga Bola Presa" },
      { property: "og:description", content: "Narrativas dos jogos e notícias da liga." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Bola Presa"
      title="Notícias"
      description="Em breve: área de notícias com narrativas dos jogos, escrita por você e seus GMs direto pelo site."
    />
  ),
});
