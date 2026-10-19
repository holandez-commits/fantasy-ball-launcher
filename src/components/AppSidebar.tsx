import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Shield, LogOut, LogIn } from "lucide-react";
import { navSections, gmItems, adminItems, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

function itemClass(active: boolean, collapsed: boolean) {
  return cn(
    "group relative my-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    active
      ? "bg-[color:var(--chrome-hover)] text-[color:var(--chrome-foreground)]"
      : "text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]",
    collapsed && "justify-center px-0",
  );
}

function ActiveBar() {
  return (
    <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-[color:var(--court-bright)]" />
  );
}

function ItemLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.to}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={itemClass(active, collapsed)}
    >
      {active && <ActiveBar />}
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/**
 * Conteúdo da navegação (usado tanto na sidebar fixa do desktop quanto na
 * gaveta do mobile). Navegação pública + gestão do GM + admin + conta.
 */
export function SidebarContent({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const { user, loading, isAdmin, isGm, teamSlug, signOut } = useAuth();
  const isActive = (to: string) =>
    pathname === to || (to !== "/" && pathname.startsWith(to + "/"));

  const SectionLabel = ({ label }: { label: string }) =>
    collapsed ? (
      <div className="mx-3 my-2 h-px bg-[color:var(--chrome-border)]" />
    ) : (
      <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[color:var(--chrome-muted)]">
        {label}
      </p>
    );

  return (
    <div className="flex h-full flex-col">
      {/* Marca */}
      <Link
        to="/"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 border-b border-[color:var(--chrome-border)] px-4 py-3",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? (
          <span className="font-display text-base font-semibold text-[color:var(--court-bright)]">
            BP
          </span>
        ) : (
          <span className="font-display text-lg font-medium tracking-tight text-[color:var(--chrome-foreground)]">
            Liga <span className="text-[color:var(--court-bright)]">Bola Presa</span>
          </span>
        )}
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {navSections.map((section, idx) => (
          <div key={section.id} className={cn(idx > 0 && "mt-4")}>
            <SectionLabel label={section.label} />
            {section.items.map((item) => (
              <ItemLink
                key={item.to}
                item={item}
                active={isActive(item.to)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}

        {!loading && (isGm || isAdmin) && (
          <div className="mt-4">
            <SectionLabel label="Gestão" />
            {teamSlug && (
              <Link
                to="/times/$slug"
                params={{ slug: teamSlug }}
                title={collapsed ? "Meu Elenco" : undefined}
                onClick={onNavigate}
                className={itemClass(pathname === `/times/${teamSlug}`, collapsed)}
              >
                {pathname === `/times/${teamSlug}` && <ActiveBar />}
                <Shield className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">Meu Elenco</span>}
              </Link>
            )}
            {gmItems.map((item) => (
              <ItemLink
                key={item.to}
                item={item}
                active={isActive(item.to)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}

        {!loading && isAdmin && (
          <div className="mt-4">
            <SectionLabel label="Admin" />
            {adminItems.map((item) => (
              <ItemLink
                key={item.to}
                item={item}
                active={isActive(item.to)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </nav>

      {/* Conta */}
      <div className="border-t border-[color:var(--chrome-border)] px-2 py-3">
        {!loading &&
          (user ? (
            <div
              className={cn(
                "flex items-center gap-2",
                collapsed ? "justify-center" : "justify-between px-1",
              )}
            >
              {!collapsed && (
                <span className="min-w-0 truncate text-xs text-[color:var(--chrome-muted)]">
                  {(user.user_metadata?.name as string | undefined) ?? user.email}
                </span>
              )}
              <button
                type="button"
                title="Sair"
                onClick={() => {
                  onNavigate?.();
                  void signOut();
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]"
              >
                <LogOut className="h-4 w-4" />
                {!collapsed && "Sair"}
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              onClick={onNavigate}
              title={collapsed ? "Entrar" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[color:var(--chrome-foreground)] hover:bg-[color:var(--chrome-hover)]",
                collapsed && "justify-center px-0",
              )}
            >
              <LogIn className="h-4 w-4 shrink-0" />
              {!collapsed && "Entrar"}
            </Link>
          ))}
      </div>
    </div>
  );
}

/**
 * Sidebar lateral fixa (desktop). Colapsável → vira faixa de ícones.
 * No mobile ela some (ver MobileNav, que reaproveita SidebarContent na gaveta).
 */
export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-[color:var(--chrome-border)] bg-[color:var(--chrome)] text-[color:var(--chrome-foreground)] transition-[width] duration-200 lg:block",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="min-h-0 flex-1 overflow-hidden">
          <SidebarContent collapsed={collapsed} />
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className="flex items-center justify-center border-t border-[color:var(--chrome-border)] py-2 text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
    </aside>
  );
}
