import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getActiveSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Sidebar lateral fixa (desktop): mostra os sub-itens da seção ativa
 * (definida pela aba selecionada no header). Colapsável → vira faixa de ícones.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const section = getActiveSection(pathname);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-[color:var(--chrome-border)] bg-[color:var(--chrome)] text-[color:var(--chrome-foreground)] transition-[width] duration-200 lg:block",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="sticky top-[57px] flex h-[calc(100vh-57px)] flex-col">
        {/* Header da sidebar = nome da seção ativa */}
        <div
          className={cn(
            "flex items-center justify-between border-b border-[color:var(--chrome-border)] px-4 py-4",
            collapsed && "justify-center px-0",
          )}
        >
          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[color:var(--chrome-muted)]">
              {section.label}
            </p>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className="rounded p-1 text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]"
          >
            <ChevronLeft
              className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
            />
          </button>
        </div>

        {/* Itens da seção */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {section.items.map((item) => {
            const isActive =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative my-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-[color:var(--chrome-hover)] text-[color:var(--chrome-foreground)]"
                    : "text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]",
                  collapsed && "justify-center px-0",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-[color:var(--court-bright)]" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="border-t border-[color:var(--chrome-border)] px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-[color:var(--chrome-muted)]">
            desde 2006
          </div>
        )}
      </div>
    </aside>
  );
}
