import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import { callRpc } from "@/lib/market";
import { espnPlayerUrl } from "@/lib/links";
import { timeAgo } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchContractMap, fmtContract, type ContractInfo } from "@/lib/contracts";

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

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Valor de <input type="datetime-local"> (horário local) para uma data. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const defaultExpires = () => toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
/** Limite do prazo: 1 mês a partir de agora. */
function maxExpires(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}
function fmtPrazo(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

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
  expires_at: string | null;
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
  const [contracts, setContracts] = useState<Map<string, ContractInfo>>(new Map());

  const [open, setOpen] = useState(false);
  const [selPlayers, setSelPlayers] = useState<string[]>([]);
  const [selPicks, setSelPicks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>(defaultExpires());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  // contrato (salário da temporada atual + anos restantes) dos jogadores exibidos
  useEffect(() => {
    const ids = [
      ...(posts ?? []).flatMap((p) => p.items.map((it) => it.player_id).filter((x): x is string => !!x)),
      ...(oferta?.players.map((p) => p.player_id) ?? []),
    ];
    if (ids.length === 0) return;
    let alive = true;
    void fetchContractMap(ids).then((m) => {
      if (alive) setContracts(m);
    });
    return () => {
      alive = false;
    };
  }, [posts, oferta]);

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
    const exp = new Date(expiresAt);
    if (!expiresAt || Number.isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
      setFormError("Informe um prazo futuro para o anúncio.");
      return;
    }
    if (exp.getTime() > maxExpires().getTime()) {
      setFormError("O prazo do anúncio pode ser de no máximo 1 mês.");
      return;
    }
    setSaving(true);
    const { error: err } = await callRpc("publicar_trade_block", {
      _players: selPlayers,
      _picks: selPicks,
      _note: note.trim() || null,
      _expires_at: exp.toISOString(),
    });
    setSaving(false);
    if (err) {
      setFormError(err.message);
      return;
    }
    setSelPlayers([]);
    setSelPicks([]);
    setNote("");
    setExpiresAt(defaultExpires());
    setOpen(false);
    await load();
  }

  async function retirar(id: string) {
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
                          {fmtContract(contracts.get(p.player_id) ?? (p.salary ? { salary: p.salary, years: 0 } : null))}
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
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  A 1ª própria bloqueada pela regra (nunca 2 anos seguidos sem ela) não pode ser anunciada.
                </p>
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

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label htmlFor="expires" className="text-sm">
              Anúncio válido até
            </label>
            <Input
              id="expires"
              type="datetime-local"
              value={expiresAt}
              max={toLocalInput(maxExpires())}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-56"
            />
            <span className="text-xs text-muted-foreground">máximo de 1 mês</span>
          </div>

          {formError && <p className="mb-2 mt-3 text-sm text-destructive">{formError}</p>}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selPlayers.length + selPicks.length} item(ns) · os outros GMs recebem um aviso no sino
            </p>
            <ConfirmButton
              size="sm"
              disabled={saving || selPlayers.length + selPicks.length === 0}
              title="Publicar este anúncio?"
              description={
                <p>
                  {selPlayers.length + selPicks.length} item(ns) vão para os classificados e os outros GMs
                  recebem um aviso no sino. O anúncio fica válido até {fmtPrazo(expiresAt)}.
                </p>
              }
              confirmLabel="Publicar"
              onConfirm={publicar}
            >
              {saving ? "Publicando…" : "Publicar"}
            </ConfirmButton>
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
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {timeAgo(p.created_at)}
                  {p.expires_at && <span className="block">válido até {fmtPrazo(p.expires_at)}</span>}
                </span>
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
                      {(() => {
                        const c = (it.player_id && contracts.get(it.player_id)) || (it.salary ? { salary: it.salary, years: 0 } : null);
                        return c ? (
                          <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{fmtContract(c)}</span>
                        ) : null;
                      })()}
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
                  <ConfirmButton
                    size="sm"
                    variant="outline"
                    title="Retirar este anúncio?"
                    description={<p>O anúncio sai dos classificados.</p>}
                    confirmLabel="Retirar"
                    onConfirm={() => retirar(p.id)}
                  >
                    Retirar
                  </ConfirmButton>
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
