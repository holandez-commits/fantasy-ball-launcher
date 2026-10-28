import {
  Trophy,
  Users,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Award,
  BookText,
  Gavel,
  UserPlus,
  UserCog,
  Store,
  Lock,
  ListChecks,
  Settings,
  ArrowLeftRight,
  CheckCircle2,
  Search,
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
 * Navegação pública (leitura): aparece na sidebar para todos.
 * A barra do topo (SiteHeader) foi aposentada — a sidebar é a navegação única.
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
        to: "/movimentacoes",
        label: "Movimentações",
        icon: ArrowLeftRight,
        desc: "Dispensas, trocas, contratações e IR",
      },
      {
        to: "/regras",
        label: "Livro de Regras",
        icon: BookText,
        desc: "Como funciona a liga",
      },
      { to: "/draft", label: "Draft", icon: Gavel, desc: "Draft da temporada" },
    ],
  },
  {
    id: "times",
    label: "Times",
    items: [
      { to: "/elencos", label: "Elencos", icon: Users, desc: "Times e jogadores" },
      { to: "/jogadores", label: "Jogadores", icon: Search, desc: "Buscar jogador e ver o time" },
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
];

/**
 * Gestão do GM (logado como gm ou admin).
 * "Meu Elenco" é dinâmico (depende do slug do time logado) e é montado
 * direto na sidebar, não aqui.
 */
export const gmItems: NavItem[] = [
  { to: "/escalar", label: "Escalar", icon: ClipboardList, desc: "Montar sua escalação" },
  { to: "/mercado", label: "Mercado", icon: Store, desc: "Dispensa, IR, trocas e leilão" },
  { to: "/leilao", label: "Free Agents", icon: UserPlus, desc: "Leilão de jogadores livres" },
];

/** Área de admin (logado como admin). */
export const adminItems: NavItem[] = [
  {
    to: "/admin/fechar-semana",
    label: "Travar semana",
    icon: Lock,
    desc: "Definir o prazo de escalação da semana",
  },
  {
    to: "/admin/consolidar-lock",
    label: "Preencher escalações pendentes",
    icon: ListChecks,
    desc: "Completar quem não escalou",
  },
  {
    to: "/admin/resultados",
    label: "Fechar jogos da semana",
    icon: CheckCircle2,
    desc: "Lançar placares e finalizar os jogos",
  },
  {
    to: "/admin/mercado",
    label: "Mercado (admin)",
    icon: Settings,
    desc: "Fila, execução e consolidação",
  },
];

/** Encontra a seção pública dona da rota atual (default: primeira). */
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
