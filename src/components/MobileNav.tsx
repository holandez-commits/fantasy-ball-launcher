import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarContent } from "./AppSidebar";

/**
 * Navegação mobile (< lg): barra fina no topo (marca + hambúrguer) que abre a
 * sidebar como gaveta. No desktop a AppSidebar fixa assume e isto some.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[color:var(--chrome-border)] bg-[color:var(--chrome)] px-4 py-3 text-[color:var(--chrome-foreground)] lg:hidden">
        <Link to="/" className="font-display text-lg font-medium tracking-tight">
          Liga <span className="text-[color:var(--court-bright)]">Bola Presa</span>
        </Link>
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center rounded-md p-2 hover:bg-[color:var(--chrome-hover)]"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-[color:var(--chrome-border)] bg-[color:var(--chrome)] text-[color:var(--chrome-foreground)] shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-end px-2 pt-2">
                <button
                  type="button"
                  aria-label="Fechar menu"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center rounded-md p-2 text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <SidebarContent onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
