import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import { callRpc, fmtMoneyShort } from "@/lib/market";
import { espnPlayerUrl } from "@/lib/links";
import { timeAgo } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/classificados")({
  head: () => ({
    meta: [
      { title: "Classificados Bola Presa — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClassificadosPage,
});

const NOTE_MAX = 200;

type BlockItem = {
  asset_type: "player" | "pick";
  player_id: string | null;
  full_name: string | null;
  espn_id: string | null;
  position: string | null;
  salary: number | null;
  pick_id: string | null;
  round: number | null;
  season_label: string | null;
  origin: string | null;
};

type Post = {
  id: string;
  team_id: string;
  team_name: string;
  team_slug: string;
  note: string | null;
  created_at: string;
  mine: boolean;
  items: BlockItem[];
};

type Ofertaveis = {
  players: { player_id: string; full_name: string; espn_id: string | null; position: string | null; salary: number | null }[];
  picks: { pick_id: string; round: number; season_label: string | null; origin: string | null }[];
};

function pickLabel(round: number | null, season: string | null, origin: string | null) {
  return `Pick ${round ?? "?"}ª · ${season ?? "—"}${origin ? ` · de ${origin}` : ""}`;
}

function ClassificadosPage() {
  const { ready, teamId } = useRequireAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [oferta, setOferta] = useState<Ofertaveis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [selPlayers, setSelPlayers] = useState<string[]>([]);
  const [selPicks, setSelPicks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await callRpc("get_trade_block");
    if (res.error) {
      setError(res.error.message);
      setPosts([]);
    } else {
      setError(null);
      setPosts((res.data ?? []) as Post[]);
    }
    if (teamId) {
      const o = await callRpc("get_trade_block_ofertaveis");
      if (!o.error && o.data) setOferta(o.data as Ofertaveis);
    }
  }, [teamId]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return null;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function publicar() {
    setFormError(null);
    if (selPlayers.length + selPicks.length === 0) {
      setFormError("Escolha pelo menos um jogador ou uma pick.");
      return;
    }
    setSaving(true);
    const { error: err } = await callRpc("publicar_trade_block", {
      _players: selPlayers,
      _picks: selPicks,
      _note: note.trim() || null,
    });
    setSaving(false);
    if (err) {
      setFormError(err.message);
      return;
    }
    setSelPlayers([]);
    setSelPicks([]);
    setNote("");
    setOpen(false);
    await load();
  }

  async function retirar(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    const { error: err } = await callRpc("retirar_trade_block", { _post_id: id });
    if (err) setError(err.message);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-medium">Classificados Bola Presa</h1>
        {teamId && (
          <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen((v) => !v)}>
            {open ? "Cancelar" : "Anunciar"}
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Jogadores e picks que os times estão dispostos a trocar. O anúncio some sozinho se o item sair do time.
      </p>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {open && teamId && (
        <section className="mb-6 rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium">O que você quer anunciar nos classificados?</h2>
          {!oferta ? (
            <Skeleton className="h-24 w-full" />
          ) : oferta.players.length + oferta.picks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Você não tem nada disponível para anunciar.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jogadores</p>
                <ul className="space-y-1">
                  {oferta.players.map((p) => (
                    <li key={p.player_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                        <Checkbox
                          checked={selPlayers.includes(p.player_id)}
                          onCheckedChange={() => toggle(selPlayers, setSelPlayers, p.player_id)}
                        />
                        <span className="font-medium">{p.full_name}</span>
                        <span className="text-xs text-muted-foreground">{p.position ?? "—"}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {p.salary ? fmtMoneyShort(p.salary) : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                  {oferta.players.length === 0 && <li className="text-sm text-muted-foreground">Nenhum jogador disponível.</li>}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Picks</p>
                <ul className="space-y-1">
                  {oferta.picks.map((p) => (
                    <li key={p.pick_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                        <Checkbox
                          checked={selPicks.includes(p.pick_id)}
                          onCheckedChange={() => toggle(selPicks, setSelPicks, p.pick_id)}
                        />
                        <span>{pickLabel(p.round, p.season_label, p.origin)}</span>
                      </label>
                    </li>
                  ))}
                  {oferta.picks.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma pick disponível.</li>}
                </ul>
              </div>
            </div>
          )}

          <div className="mt-4">
            <Textarea
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Ex.: "aceito qualquer oferta por uma 1ª"'
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {note.length}/{NOTE_MAX}
            </p>
          </div>

          {formError && <p className="mb-2 text-sm text-destructive">{formError}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selPlayers.length + selPicks.length} item(ns) · os outros GMs recebem um aviso no sino
            </p>
            <Button size="sm" disabled={saving || selPlayers.length + selPicks.length === 0} onClick={() => void publicar()}>
              {saving ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </section>
      )}

      {posts === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          Nenhum anúncio no momento.{teamId ? " Seja o primeiro: clique em “Anunciar”." : ""}
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className={cn("rounded-lg border p-4", p.mine && "border-[color:var(--court-bright)]/50")}>
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  to="/times/$slug"
                  params={{ slug: p.team_slug }}
                  className="font-medium hover:text-[color:var(--court)] hover:underline"
                >
                  {p.team_name}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(p.created_at)}</span>
              </div>
              {p.note && <p className="mt-1.5 text-sm italic text-muted-foreground">“{p.note}”</p>}
              <ul className="mt-3 flex flex-wrap gap-2">
                {p.items.map((it) =>
                  it.asset_type === "player" ? (
                    <li
                      key={`pl-${it.player_id}`}
                      className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm"
                    >
                      {it.espn_id ? (
                        <a
                          href={espnPlayerUrl(it.espn_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver na ESPN"
                          className="font-medium hover:underline"
                        >
                          {it.full_name}
                        </a>
                      ) : (
                        <span className="font-medium">{it.full_name}</span>
                      )}
                      <span className="ml-1.5 text-xs text-muted-foreground">{it.position ?? "—"}</span>
                      {it.salary ? (
                        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{fmtMoneyShort(it.salary)}</span>
                      ) : null}
                    </li>
                  ) : (
                    <li key={`pk-${it.pick_id}`} className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm">
                      {pickLabel(it.round, it.season_label, it.origin)}
                    </li>
                  ),
                )}
              </ul>
              <div className="mt-3 flex justify-end gap-2">
                {p.mine ? (
                  <Button size="sm" variant="outline" onClick={() => void retirar(p.id)}>
                    {confirmId === p.id ? "Confirmar retirada" : "Retirar"}
                  </Button>
                ) : teamId ? (
                  <Button size="sm" asChild>
                    <Link to="/trocar" search={{ com: p.team_id }}>
                      Propor troca
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
