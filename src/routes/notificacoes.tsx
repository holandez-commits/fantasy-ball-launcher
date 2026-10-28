import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import { callRpc } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  notifyChanged,
  timeAgo,
  useNotifications,
  type NotificationItem,
} from "@/lib/notifications";

export const Route = createFileRoute("/notificacoes")({
  head: () => ({
    meta: [{ title: "Notificações — Liga Bola Presa de Fantasy" }],
  }),
  component: NotificacoesPage,
});

const PAGE = 30;

type Pref = { category: string; enabled: boolean };

function NotificacoesPage() {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <Conteudo />;
}

function Conteudo() {
  const navigate = useNavigate();
  const { unread, markRead, markAllRead } = useNotifications(1);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    const { data, error } = await callRpc("get_notificacoes", { _limit: PAGE, _offset: offset });
    if (error || !data) {
      setErr(error?.message ?? "Não foi possível carregar.");
      setLoading(false);
      return;
    }
    const d = data as { total: number; items: NotificationItem[] };
    setTotal(d.total);
    setItems((prev) => (offset === 0 ? d.items : [...prev, ...d.items]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(0);
    void callRpc("get_notificacao_prefs").then(({ data }) => {
      if (Array.isArray(data)) setPrefs(data as Pref[]);
    });
  }, [load]);

  async function togglePref(category: string, enabled: boolean) {
    setPrefs((p) => p.map((x) => (x.category === category ? { ...x, enabled } : x)));
    const { error } = await callRpc("set_notificacao_pref", { _category: category, _enabled: enabled });
    if (error) {
      setErr(error.message);
      setPrefs((p) => p.map((x) => (x.category === category ? { ...x, enabled: !enabled } : x)));
    }
  }

  async function readOne(n: NotificationItem) {
    if (!n.read_at) {
      await markRead(n.id);
      setItems((p) => p.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
    }
    if (n.link) void navigate({ to: n.link as never });
  }

  async function readAll() {
    await markAllRead();
    setItems((p) => p.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })));
    notifyChanged();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-medium">Notificações</h1>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => void readAll()}>
          Marcar todas como lidas
        </Button>
      </div>

      {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

      <section className="mb-8 rounded-lg border">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma notificação por enquanto. Os avisos ficam guardados por 60 dias.
          </p>
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => void readOne(n)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent",
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
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                      {CATEGORY_LABELS[n.category]?.label ?? n.category}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length < total && (
          <div className="border-t p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => void load(items.length)}>
              Carregar mais
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-medium">O que você quer receber</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Desligar uma categoria só afeta avisos novos; o que já chegou continua na lista.
        </p>
        <ul className="rounded-lg border">
          {prefs.map((p) => (
            <li
              key={p.category}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{CATEGORY_LABELS[p.category]?.label ?? p.category}</p>
                <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[p.category]?.hint}</p>
              </div>
              <Switch checked={p.enabled} onCheckedChange={(v) => void togglePref(p.category, v)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
