import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { timeAgo, useNotifications, type NotificationItem } from "@/lib/notifications";

/**
 * Sino de notificações. Aparece só para usuário logado. Contador de não lidas,
 * painel com as últimas 15 e atalho para /notificacoes (lista completa + preferências).
 */
export function NotificationBell({
  side = "right",
  align = "start",
  onNavigate,
  className,
}: {
  side?: "right" | "bottom";
  align?: "start" | "end";
  onNavigate?: () => void;
  className?: string;
}) {
  const { enabled, unread, items, ready, markRead, markAllRead } = useNotifications(15);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!enabled) return null;

  function openItem(n: NotificationItem) {
    void markRead(n.id);
    setOpen(false);
    onNavigate?.();
    if (n.link) void navigate({ to: n.link as never });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : "Notificações"}
          title="Notificações"
          className={cn(
            "relative inline-flex items-center justify-center rounded-md p-2 text-[color:var(--chrome-muted)] hover:bg-[color:var(--chrome-hover)] hover:text-[color:var(--chrome-foreground)]",
            className,
          )}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--court-bright)] px-1 text-[10px] font-semibold leading-none text-black">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[22rem] max-w-[92vw] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notificações</span>
          <button
            type="button"
            disabled={unread === 0}
            onClick={() => void markAllRead()}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Marcar todas como lidas
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!ready ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação por enquanto.
            </p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent",
                      !n.read_at && "bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        n.read_at ? "bg-transparent" : "bg-[color:var(--court-bright)]",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      {n.body && (
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-center">
          <Link
            to="/notificacoes"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Ver todas e configurar
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
