import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/PagePlaceholder";

export const Route = createFileRoute("/times_/$slug")({
  component: TimePage,
});

function TimePage() {
  const { slug } = Route.useParams();
  return (
    <PagePlaceholder
      eyebrow="Time"
      title={slug}
      description="A página individual de cada time será construída em breve."
    />
  );
}