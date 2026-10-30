// Sino de notificações: tipos + hook com polling (20s) das RPCs do banco.
import { useCallback, useEffect, useRef, useState } from "react";
import { callRpc } from "@/lib/market";
import { useAuth } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  category: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationsPayload = { unread: number; total: number; items: NotificationItem[] };

export const CATEGORY_LABELS: Record<string, { label: string; hint: string }> = {
  mercado: { label: "Mercado", hint: "Abertura e fechamento do mercado" },
  prazo: { label: "Prazo de escalação", hint: "Prazo definido ou alterado" },
  jogo: { label: "Jogos do meu time", hint: "Resultado dos confrontos concluídos" },
  troca: { label: "Propostas e decisões", hint: "Propostas recebidas, aceites, recusas e decisões do admin" },
  bloco: { label: "Classificados Bola Presa", hint: "Times que anunciam jogadores e picks para troca" },
  movimentacao: { label: "Movimentações da liga", hint: "Trocas, dispensas e IR executados por qualquer time" },
  leilao: { label: "Leilão", hint: "Contratações do leilão e lances perdidos" },
  admin: { label: "Avisos da administração", hint: "Comunicados gerais" },
};

const EMPTY: NotificationsPayload = { unread: 0, total: 0, items: [] };
const POLL_MS = 120_000; // 2 min (s19: era 20 s). Também recarrega ao voltar para a aba e ao marcar como lida.
const CHANGED_EVENT = "notifications:changed";

export function notifyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useNotifications(limit = 15) {
  const { user, loading } = useAuth();
  const [data, setData] = useState<NotificationsPayload>(EMPTY);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);
  const enabled = !loading && !!user;

  const reload = useCallback(async () => {
    if (!enabled) return;
    const { data: d, error } = await callRpc("get_notificacoes", { _limit: limit, _offset: 0 });
    if (!alive.current || error || !d) return;
    setData(d as NotificationsPayload);
    setReady(true);
  }, [enabled, limit]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setData(EMPTY);
      setReady(false);
      return;
    }
    void reload();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    const onChanged = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener(CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(t);
      window.removeEventListener(CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);

  const markRead = useCallback(async (id: string) => {
    setData((p) => ({
      ...p,
      unread: Math.max(0, p.unread - (p.items.find((i) => i.id === id && !i.read_at) ? 1 : 0)),
      items: p.items.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i)),
    }));
    await callRpc("marcar_notificacao_lida", { _id: id });
    notifyChanged();
  }, []);

  const markAllRead = useCallback(async () => {
    setData((p) => ({
      ...p,
      unread: 0,
      items: p.items.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })),
    }));
    await callRpc("marcar_todas_notificacoes_lidas");
    notifyChanged();
  }, []);

  return { ...data, ready, enabled, reload, markRead, markAllRead };
}

/** "agora", "há 5 min", "há 3 h", "há 2 d" ou data curta. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
