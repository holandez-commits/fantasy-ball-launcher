import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/escalacoes")({
  head: () => ({
    meta: [
      { title: "Escalações — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Escalações da rodada na Liga Bola Presa de Fantasy." },
      { property: "og:title", content: "Escalações — Liga Bola Presa" },
      { property: "og:description", content: "Escalações da rodada atual." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Rodada atual"
      title="Escalações"
      description="Escalações de cada GM serão exibidas aqui, sincronizadas com a planilha de escalações."
    />
  ),
});
