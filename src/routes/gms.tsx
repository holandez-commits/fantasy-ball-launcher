import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/gms")({
  head: () => ({
    meta: [
      { title: "GMs — Liga Bola Presa de Fantasy" },
      { name: "description", content: "General Managers da Liga Bola Presa." },
      { property: "og:title", content: "GMs — Liga Bola Presa" },
      { property: "og:description", content: "General Managers da liga." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Comandantes"
      title="GMs"
      description="Conheça os General Managers que comandam as franquias da liga."
    />
  ),
});
