import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PagePlaceholder({ eyebrow, title, description }: Props) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--court)]">{eyebrow}</p>
      <h1 className="mt-4 font-display text-4xl tracking-tight md:text-6xl">{title}</h1>
      <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
        {description}
      </p>
      <div className="mt-10 rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        <p>
          Esta página é um esboço. Conteúdo real chega na próxima etapa, quando conectarmos sua
          conta do Google Sheets (ou ativarmos o sistema de notícias).
        </p>
      </div>
      <Link
        to="/"
        className="mt-10 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para a home
      </Link>
    </div>
  );
}
