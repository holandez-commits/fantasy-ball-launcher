import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { navSections, getActiveSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const { pathname } = useLocation();
  const active = getActiveSection(pathname);
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-[color:var(--chrome)] text-[color:var(--chrome-foreground)]">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-4 py-3 md:px-6">
        {/* Brand */}
        <Link to="/" className="flex items-baseline gap-2 shrink-0">
          <span className="font-display text-lg font-medium tracking-tight">
            Liga <span className="text-[color:var(--court-bright)]">Bola Presa</span>
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.25em] text-[color:var(--chrome-muted)] md:inline">
            Fantasy
          </span>
        </Link>

        {/* Seções principais */}
        <nav className="hidden items-stretch gap-1 lg:flex">
          {navSections.map((section) => {
            const isActive = section.id === active.id;
            // primeiro item da seção como destino padrão
            const target = section.items[0]?.to ?? "/";
            return (
              <Link
                key={section.id}
                to={target}
                className={cn(
                  "relative flex items-center px-4 py-2 text-[13px] font-medium uppercase tracking-wider transition-colors",
                  isActive
                    ? "text-[color:var(--chrome-foreground)]"
                    : "text-[color:var(--chrome-muted)] hover:text-[color:var(--chrome-foreground)]",
                )}
              >
                {section.label}
                {isActive && (
                  <span className="absolute inset-x-3 -bottom-3 h-[3px] bg-[color:var(--court-bright)]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right slot — placeholder p/ futura área de login/admin */}
        <div className="hidden items-center gap-3 lg:flex">
          <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--chrome-muted)]">
            Temp. 25/26
          </span>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-[color:var(--chrome-foreground)] lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer simples — lista todas as seções e sub-itens */}
      {open && (
        <div className="border-t border-[color:var(--chrome-border)] bg-[color:var(--chrome)] lg:hidden">
          <nav className="mx-auto flex max-w-[1400px] flex-col px-2 py-2">
            {navSections.map((section) => (
              <div key={section.id} className="py-2">
                <p className="px-3 pb-1 text-[10px] uppercase tracking-[0.25em] text-[color:var(--chrome-muted)]">
                  {section.label}
                </p>
                {section.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[color:var(--chrome-foreground)] hover:bg-[color:var(--chrome-hover)]"
                  >
                    <item.icon className="h-4 w-4 text-[color:var(--chrome-muted)]" />
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
