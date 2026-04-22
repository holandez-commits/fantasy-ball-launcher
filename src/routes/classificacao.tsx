import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/classificacao")({
  head: () => ({
    meta: [
      { title: "Classificação — Liga Bola Presa de Fantasy" },
      { name: "description", content: "Tabela completa da temporada 2025/26 da Liga Bola Presa." },
      { property: "og:title", content: "Classificação — Liga Bola Presa" },
      { property: "og:description", content: "Tabela completa da temporada 2025/26." },
    ],
  }),
  component: () => (
    <PagePlaceholder
      eyebrow="Temporada 2025/26"
      title="Classificação"
      description="A tabela completa será carregada da sua planilha do Google Sheets assim que conectarmos sua conta."
    />
  ),
});
