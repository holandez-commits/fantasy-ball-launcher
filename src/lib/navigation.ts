import {
  Trophy,
  Users,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Award,
  BookText,
  Newspaper,
  Home,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  desc?: string;
};

export type NavSection = {
  id: string;
  label: string;
  /** Sub-rotas que pertencem a esta seção (aparecem na sidebar). */
  items: NavItem[];
};

/**
 * Navegação principal: cada "seção" é uma aba do header.
 * Os `items` de cada seção viram a lista da sidebar quando essa seção está ativa.
 */
export const navSections: NavSection[] = [
  {
    id: "liga",
    label: "Liga",
    items: [
      { to: "/", label: "Início", icon: Home, desc: "Visão geral" },
      {
        to: "/classificacao",
        label: "Classificação",
        icon: Trophy,
        desc: "Tabela da temporada",
      },
      {
        to: "/calendario",
        label: "Calendário",
        icon: CalendarDays,
        desc: "Jogos e rodadas",
      },
      { to: "/regras", label: "Regras", icon: BookText, desc: "Como funciona a liga" },
    ],
  },
  {
    id: "times",
    label: "Times",
    items: [
      { to: "/elencos", label: "Elencos", icon: Users, desc: "Times e jogadores" },
      {
        to: "/escalacoes",
        label: "Escalações",
        icon: ClipboardList,
        desc: "Quem joga essa rodada",
      },
    ],
  },
  {
    id: "stats",
    label: "Estatísticas",
    items: [
      { to: "/medias", label: "Médias", icon: BarChart3, desc: "Médias dos jogadores" },
      { to: "/recordes", label: "Recordes", icon: Award, desc: "Marcas históricas" },
    ],
  },
  {
    id: "conteudo",
    label: "Conteúdo",
    items: [
      {
        to: "/noticias",
        label: "Notícias",
        icon: Newspaper,
        desc: "Narrativas e crônicas dos jogos",
      },
    ],
  },
];

/** Encontra a seção dona da rota atual (default: primeira). */
export function getActiveSection(pathname: string): NavSection {
  // Match exato primeiro
  for (const section of navSections) {
    if (section.items.some((i) => i.to === pathname)) return section;
  }
  // Match por prefixo (rotas filhas tipo /noticias/$slug)
  for (const section of navSections) {
    if (section.items.some((i) => i.to !== "/" && pathname.startsWith(i.to))) {
      return section;
    }
  }
  return navSections[0];
}
