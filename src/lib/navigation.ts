import {
  Trophy,
  Users,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Award,
  BookText,
  Newspaper,
  Gavel,
  UserPlus,
  UserCog,
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
 * Navegação principal: cada "seção" é uma aba do header (Hierarquia 1).
 * Os `items` de cada seção (Hierarquia 2) aparecem agrupados na sidebar,
 * todos visíveis o tempo todo.
 */
export const navSections: NavSection[] = [
  {
    id: "liga",
    label: "Liga",
    items: [
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
      {
        to: "/regras",
        label: "Livro de Regras",
        icon: BookText,
        desc: "Como funciona a liga",
      },
      { to: "/draft", label: "Draft", icon: Gavel, desc: "Draft da temporada" },
      {
        to: "/free-agents",
        label: "Free Agents",
        icon: UserPlus,
        desc: "Mercado de jogadores livres",
      },
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
      { to: "/gms", label: "GMs", icon: UserCog, desc: "General Managers da liga" },
    ],
  },
  {
    id: "stats",
    label: "Estatísticas",
    items: [
      { to: "/recordes", label: "Recordes", icon: Award, desc: "Marcas históricas" },
      { to: "/medias", label: "Médias", icon: BarChart3, desc: "Médias dos jogadores" },
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
  for (const section of navSections) {
    if (section.items.some((i) => i.to === pathname)) return section;
  }
  for (const section of navSections) {
    if (section.items.some((i) => i.to !== "/" && pathname.startsWith(i.to))) {
      return section;
    }
  }
  return navSections[0];
}
