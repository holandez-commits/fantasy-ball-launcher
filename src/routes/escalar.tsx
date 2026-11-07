import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { standingFor, type ConfTeam, type StandRow, type Standing } from "@/lib/standings-rank";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/escalar")({
  head: () => ({
    meta: [
      { title: "Escalação — Liga Bola Presa de Fantasy" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EscalarPage,
});

// Tipagem frouxa: types.ts está defasado em relação ao banco vivo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: unknown) => any };

type Position = { id: string; code: string; name: string; sort_order: number; accepts_any: boolean };
type Lock = { id: string; season_id: string; week_number: number; locks_at: string };
type RosterRow = { player_id: string; position: string; status: string };
type SlotType = "titular" | "reserva";
type SlotRow = { position_id: string; slot_type: SlotType; player_id: string };
/** chave "<position_id>:<slot_type>" -> player_id */
type Selection = Record<string, string>;

type Opponent = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  conference: string | null;
  standing: Standing | null;
};
type GameInfo = { id: string; number: number; opp: Opponent | null };

const slotKey = (positionId: string, type: SlotType) => `${positionId}:${type}`;
const NONE = "__none";
const EMPTY: Selection = {};
const TOTAL_SLOTS = 12;

const sigOf = (sel: Selection) =>
  Object.entries(sel)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("|");

function codesOf(position: string) {
  return position.split("/").map((c) => c.trim());
}

function fits(pos: Position, player: RosterRow) {
  return pos.accepts_any || codesOf(player.position).includes(pos.code);
}

function friendlyError(message: string): { text: string; expired: boolean } {
  const m = message.toLowerCase();
  if (m.includes("prazo encerrado")) return { text: "Prazo encerrado para esta semana.", expired: true };
  if (m.includes("ainda não foi aberta") || m.includes("ainda nao foi aberta"))
    return { text: "A escalação desta semana ainda não foi aberta.", expired: false };
  if (m.includes("não está no elenco") || m.includes("nao esta no elenco"))
    return { text: "Um dos jogadores não está no seu elenco desta semana.", expired: false };
  if (m.includes("não joga na posição") || m.includes("nao joga na posicao"))
    return { text: "Um dos jogadores não joga na posição escolhida.", expired: false };
  if (m.includes("uq_lineup_titular_unico") || m.includes("duplicate key"))
    return { text: "Um jogador não pode ser titular em mais de uma posição.", expired: false };
  return { text: message, expired: false };
}

/**
 * Grava uma escalação em UM jogo: upsert do matchup_lineups (game_id, team_id) e
 * substituição dos lineup_slots. Slots vazios simplesmente não são inseridos (salvamento parcial).
 * Se a inserção falhar (ex.: trigger), tenta restaurar os slots anteriores.
 */
async function gravarEscalacaoNoJogo(gameId: string, teamId: string, slots: SlotRow[]) {
  const up = await db
    .from("matchup_lineups")
    .upsert({ game_id: gameId, team_id: teamId }, { onConflict: "game_id,team_id" })
    .select("id")
    .single();
  if (up.error) throw new Error(up.error.message);
  const lineupId: string = up.data.id;

  const prev = await db
    .from("lineup_slots")
    .select("position_id, slot_type, player_id")
    .eq("lineup_id", lineupId);
  if (prev.error) throw new Error(prev.error.message);

  const del = await db.from("lineup_slots").delete().eq("lineup_id", lineupId);
  if (del.error) throw new Error(del.error.message);

  if (slots.length === 0) return;
  const ins = await db
    .from("lineup_slots")
    .insert(slots.map((s) => ({ lineup_id: lineupId, ...s })));
  if (ins.error) {
    if ((prev.data ?? []).length > 0) {
      await db
        .from("lineup_slots")
        .insert((prev.data as SlotRow[]).map((s) => ({ lineup_id: lineupId, ...s })));
    }
    throw new Error(ins.error.message);
  }
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function OppBadge({ opp, size = 32 }: { opp: Opponent; size?: number }) {
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{ background: opp.primary_color ?? "#374151", width: size, height: size, fontSize: size * 0.34 }}
    >
      {opp.logo_url ? (
        <img src={opp.logo_url} alt={opp.name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials(opp.name)}</span>
      )}
    </div>
  );
}

function standingText(s: Standing | null, conference: string | null): string | null {
  if (!s) return null;
  const rec = `${s.w}-${s.l}-${s.d}`;
  return s.rank != null && conference ? `${rec} · ${s.rank}º na ${conference}` : rec;
}

function EscalarPage() {
  const { ready, forbidden, teamId, isAdmin } = useRequireAuth({ role: "gm" });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [lock, setLock] = useState<Lock | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [games, setGames] = useState<GameInfo[]>([]);
  const [gamesWithLineup, setGamesWithLineup] = useState<string[]>([]);
  /** escalação gravada no banco, por jogo */
  const [saved, setSaved] = useState<Record<string, Selection>>({});
  /** o que está na tela, por jogo (mantém as edições ao trocar de jogo) */
  const [drafts, setDrafts] = useState<Record<string, Selection>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [forcedExpired, setForcedExpired] = useState(false);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(
    async (lockId?: string) => {
      if (!teamId) return;
      setLoading(true);
      setLoadError(null);
      try {
        const posRes = await db
          .from("positions")
          .select("id, code, name, sort_order, accepts_any")
          .order("sort_order");
        if (posRes.error) throw new Error(posRes.error.message);
        setPositions(posRes.data as Position[]);

        // Semana escalável: lock futuro de menor locks_at (ou o lock atual, ao recarregar).
        const lockQ = db.from("roster_locks").select("id, season_id, week_number, locks_at");
        const lockRes = lockId
          ? await lockQ.eq("id", lockId).limit(1)
          : await lockQ
              .gt("locks_at", new Date().toISOString())
              .order("locks_at", { ascending: true })
              .limit(1);
        if (lockRes.error) throw new Error(lockRes.error.message);
        const cur = (lockRes.data as Lock[])[0] ?? null;
        setLock(cur);
        if (!cur) {
          setLoading(false);
          return;
        }

        // Elenco AO VIVO (roster_entries): mesma regra que o banco usa pra validar o slot.
        const seasonRes = await db
          .from("seasons")
          .select("start_year")
          .eq("id", cur.season_id)
          .limit(1);
        if (seasonRes.error) throw new Error(seasonRes.error.message);
        const startYear = (seasonRes.data as { start_year: number }[])[0]?.start_year;
        const [rosterRes, gamesRes] = await Promise.all([
          db
            .from("roster_entries")
            .select("player_id, position, status")
            .eq("team_id", teamId)
            .eq("season", startYear)
            .not("position", "is", null),
          db
            .from("games")
            .select("id, game_number_in_week, home_team_id, away_team_id")
            .eq("season_id", cur.season_id)
            .eq("week_number", cur.week_number)
            .eq("status", "scheduled")
            .eq("is_playoff", false)
            .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
            .order("game_number_in_week", { ascending: true }),
        ]);
        if (rosterRes.error) throw new Error(rosterRes.error.message);
        if (gamesRes.error) throw new Error(gamesRes.error.message);

        const rosterRows = rosterRes.data as RosterRow[];
        setRoster(rosterRows);
        const gameRows = gamesRes.data as {
          id: string;
          game_number_in_week: number;
          home_team_id: string;
          away_team_id: string;
        }[];
        const ids = gameRows.map((g) => g.id);

        const playerIds = [...new Set(rosterRows.map((r) => r.player_id))];
        if (playerIds.length > 0) {
          const pRes = await db.from("players").select("id, full_name").in("id", playerIds);
          if (pRes.error) throw new Error(pRes.error.message);
          setNames(
            Object.fromEntries((pRes.data as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])),
          );
        }

        // Adversários + campanha. Falha aqui não impede de escalar: só some a informação.
        const oppOf = (g: (typeof gameRows)[number]) =>
          g.home_team_id === teamId ? g.away_team_id : g.home_team_id;
        const oppById = new Map<string, Opponent>();
        try {
          const oppIds = [...new Set(gameRows.map(oppOf))];
          if (oppIds.length > 0) {
            const [tRes, actRes, stRes] = await Promise.all([
              db
                .from("teams")
                .select("id, name, slug, logo_url, primary_color, conference")
                .in("id", oppIds),
              db.from("teams").select("id, name, conference").eq("is_active", true),
              db.rpc("get_standings", { season_ids: [cur.season_id] }),
            ]);
            const active = (actRes.data ?? []) as ConfTeam[];
            const rows = (stRes.data ?? []) as StandRow[];
            for (const t of (tRes.data ?? []) as Omit<Opponent, "standing">[]) {
              oppById.set(t.id, {
                ...t,
                standing: stRes.error ? null : standingFor(t.id, active, rows),
              });
            }
          }
        } catch {
          /* sem dados do adversário */
        }
        const gameInfos: GameInfo[] = gameRows.map((g) => ({
          id: g.id,
          number: g.game_number_in_week,
          opp: oppById.get(oppOf(g)) ?? null,
        }));
        setGames(gameInfos);

        // Escalação existente de cada jogo da semana.
        const savedBy: Record<string, Selection> = {};
        let withLineup: string[] = [];
        let dropped = 0;
        if (ids.length > 0) {
          const lRes = await db
            .from("matchup_lineups")
            .select("id, game_id")
            .eq("team_id", teamId)
            .in("game_id", ids);
          if (lRes.error) throw new Error(lRes.error.message);
          const lineups = lRes.data as { id: string; game_id: string }[];
          withLineup = lineups.map((l) => l.game_id);
          let slots: (SlotRow & { lineup_id: string })[] = [];
          if (lineups.length > 0) {
            const sRes = await db
              .from("lineup_slots")
              .select("lineup_id, position_id, slot_type, player_id")
              .in("lineup_id", lineups.map((l) => l.id));
            if (sRes.error) throw new Error(sRes.error.message);
            slots = sRes.data as (SlotRow & { lineup_id: string })[];
          }
          const validIds = new Set(rosterRows.filter((r) => r.status === "active").map((r) => r.player_id));
          for (const l of lineups) {
            const sel: Selection = {};
            for (const s of slots.filter((x) => x.lineup_id === l.id)) {
              if (validIds.has(s.player_id)) sel[slotKey(s.position_id, s.slot_type)] = s.player_id;
              else dropped++;
            }
            savedBy[l.game_id] = sel;
          }
        }
        setSaved(savedBy);
        setDrafts(Object.fromEntries(ids.map((id) => [id, { ...(savedBy[id] ?? {}) }])));
        setGamesWithLineup(withLineup);
        setActiveId((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? null)));
        setNotice(
          dropped > 0
            ? `${dropped} slot(s) removido(s) da visualização: o jogador não está mais ativo no elenco.`
            : null,
        );
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Erro ao carregar a escalação.");
      } finally {
        setLoading(false);
      }
    },
    [teamId],
  );

  useEffect(() => {
    if (ready && teamId) void load();
  }, [ready, teamId, load]);

  const expired = forcedExpired || (!!lock && now >= new Date(lock.locks_at).getTime());
  const editable = !expired || isAdmin;

  const gameIds = useMemo(() => games.map((g) => g.id), [games]);
  const activeGame = games.find((g) => g.id === activeId) ?? null;
  const selection: Selection = (activeId && drafts[activeId]) || EMPTY;

  const activePlayers = useMemo(() => {
    const seen = new Set<string>();
    return roster.filter((r) => r.status === "active" && !seen.has(r.player_id) && seen.add(r.player_id));
  }, [roster]);
  const injured = useMemo(() => roster.filter((r) => r.status !== "active"), [roster]);
  const nameOf = (id: string) => names[id] ?? "Jogador";

  const titularIds = (exceptKey?: string) =>
    new Set(
      positions
        .map((p) => slotKey(p.id, "titular"))
        .filter((k) => k !== exceptKey)
        .map((k) => selection[k])
        .filter(Boolean),
    );

  function optionsFor(pos: Position, type: SlotType) {
    const key = slotKey(pos.id, type);
    const taken = type === "titular" ? titularIds(key) : new Set<string>();
    return activePlayers.filter((p) => fits(pos, p) && !taken.has(p.player_id));
  }

  function setSlot(pos: Position, type: SlotType, playerId: string) {
    if (!activeId) return;
    setResult(null);
    setDrafts((cur) => {
      const next = { ...(cur[activeId] ?? {}) };
      const key = slotKey(pos.id, type);
      if (playerId === NONE) delete next[key];
      else next[key] = playerId;
      return { ...cur, [activeId]: next };
    });
  }

  function buildSlots(sel: Selection): { slots: SlotRow[]; error: string | null } {
    const slots: SlotRow[] = [];
    const titulares = new Set<string>();
    for (const pos of positions) {
      for (const type of ["titular", "reserva"] as SlotType[]) {
        const pid = sel[slotKey(pos.id, type)];
        if (!pid) continue;
        const player = activePlayers.find((p) => p.player_id === pid);
        if (!player) return { slots, error: `${nameOf(pid)} não está ativo no seu elenco.` };
        if (!fits(pos, player))
          return { slots, error: `${nameOf(pid)} não joga na posição ${pos.code}.` };
        if (type === "titular") {
          if (titulares.has(pid)) return { slots, error: `${nameOf(pid)} está como titular em mais de uma posição.` };
          titulares.add(pid);
        }
        slots.push({ position_id: pos.id, slot_type: type, player_id: pid });
      }
    }
    return { slots, error: null };
  }

  // mesmo jogador como titular e reserva na MESMA posição (permitido, mas quase sempre erro)
  const duplicatas = useMemo(() => {
    const out: { pos: string; name: string }[] = [];
    for (const pos of positions) {
      const t = selection[slotKey(pos.id, "titular")];
      const r = selection[slotKey(pos.id, "reserva")];
      if (t && r && t === r) out.push({ pos: pos.code, name: names[t] ?? "Jogador" });
    }
    return out;
  }, [positions, selection, names]);

  type Kind = "jogo" | "todos";
  const [dupOpen, setDupOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState<Kind>("jogo");
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  /** "aplicar a todos" sobrescreveria a escalação já salva e diferente de algum outro jogo */
  const overwritesOthers = games.some((g) => {
    if (g.id === activeId) return false;
    const s = sigOf(saved[g.id] ?? EMPTY);
    return s !== "" && s !== sigOf(selection);
  });

  function request(kind: Kind) {
    setPendingKind(kind);
    if (duplicatas.length > 0) {
      setDupOpen(true);
      return;
    }
    proceed(kind);
  }

  function proceed(kind: Kind) {
    if (kind === "todos" && overwritesOthers) {
      setConfirmAllOpen(true);
      return;
    }
    void persist(kind === "jogo" && activeId ? [activeId] : gameIds, selection);
  }

  async function persist(targets: string[], sel: Selection) {
    if (!teamId || !lock) return;
    setResult(null);
    if (!isAdmin && now >= new Date(lock.locks_at).getTime()) {
      setForcedExpired(true);
      setResult({ ok: false, message: "Prazo encerrado para esta semana." });
      return;
    }
    const { slots, error } = buildSlots(sel);
    if (error) {
      setResult({ ok: false, message: error });
      return;
    }
    if (targets.length === 0) {
      setResult({ ok: false, message: "Não há jogo aberto nesta semana para escalar." });
      return;
    }
    setSaving(true);
    const done: string[] = [];
    const markSaved = (ids: string[]) => {
      if (ids.length === 0) return;
      setSaved((cur) => ({ ...cur, ...Object.fromEntries(ids.map((g) => [g, { ...sel }])) }));
      setDrafts((cur) => ({ ...cur, ...Object.fromEntries(ids.map((g) => [g, { ...sel }])) }));
      setGamesWithLineup((cur) => [...new Set([...cur, ...ids])]);
    };
    try {
      for (const gameId of targets) {
        await gravarEscalacaoNoJogo(gameId, teamId, slots);
        done.push(gameId);
      }
      markSaved(done);
      const label = (id: string) => `jogo ${games.find((g) => g.id === id)?.number ?? ""}`.trim();
      setResult({
        ok: true,
        message:
          targets.length === 1
            ? `Escalação salva no ${label(targets[0])} da semana ${lock.week_number}.`
            : `Escalação salva em ${targets.length} jogos da semana ${lock.week_number}.`,
      });
    } catch (e) {
      markSaved(done);
      const { text, expired: exp } = friendlyError(e instanceof Error ? e.message : String(e));
      setResult({
        ok: false,
        message:
          done.length > 0 ? `${text} (salvo em ${done.length} de ${targets.length} jogos antes do erro.)` : text,
      });
      if (exp) {
        setForcedExpired(true);
        await load(lock.id);
      }
    } finally {
      setSaving(false);
    }
  }

  function statusOf(gameId: string): { text: string; tone: "ok" | "warn" | "muted" } {
    const dirty = sigOf(drafts[gameId] ?? EMPTY) !== sigOf(saved[gameId] ?? EMPTY);
    if (dirty) return { text: "alterações não salvas", tone: "warn" };
    const n = Object.keys(saved[gameId] ?? EMPTY).length;
    if (gamesWithLineup.includes(gameId) && n > 0) return { text: `escalado (${n}/${TOTAL_SLOTS})`, tone: "ok" };
    return { text: "sem escalação", tone: "muted" };
  }

  if (forbidden) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">Esta área é restrita a GMs da liga.</p>
      </Shell>
    );
  }
  if (!ready) return null;

  if (!teamId) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Escalação</h1>
        <Alert className="mt-6">
          <AlertDescription>Sua conta não tem time associado.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-72 w-full" />
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Escalação</h1>
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (!lock) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Escalação</h1>
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma semana aberta pra escalação agora.</p>
      </Shell>
    );
  }

  const deadline = new Date(lock.locks_at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const multi = games.length > 1;

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Semana {lock.week_number}</p>
      <h1 className="mt-1 font-display text-3xl">Escalação</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Prazo: {deadline} (horário de Brasília).{" "}
        {multi
          ? "Escale jogo a jogo ou aplique a mesma escalação a todos os jogos da semana."
          : "Escalação do seu jogo da semana."}
      </p>

      {expired && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Prazo encerrado</AlertTitle>
          <AlertDescription>
            {isAdmin
              ? "O prazo passou; como admin você ainda pode editar."
              : "A escalação está em modo somente leitura."}
          </AlertDescription>
        </Alert>
      )}
      {!expired && games.length === 0 && (
        <Alert className="mt-6">
          <AlertDescription>Não há jogo aberto nesta semana para escalar.</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mt-6">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {games.length > 0 && (
        <>
          <h2 className="mt-8 font-display text-xl">Seus jogos da semana</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {games.map((g) => {
              const st = statusOf(g.id);
              const active = g.id === activeId;
              const text = g.opp ? standingText(g.opp.standing, g.opp.conference) : null;
              return (
                <div
                  key={g.id}
                  className={cn(
                    "min-w-[200px] flex-1 rounded-lg border bg-card transition-colors",
                    active ? "border-[color:var(--court)] ring-1 ring-[color:var(--court)]/40" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(g.id)}
                    aria-pressed={active}
                    className="block w-full rounded-t-lg px-3 pb-2 pt-3 text-left hover:bg-muted/40"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Jogo {g.number}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2.5">
                      {g.opp && <OppBadge opp={g.opp} />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {g.opp ? `vs ${g.opp.name}` : "Adversário não encontrado"}
                        </span>
                        {text && <span className="block text-xs tabular-nums text-muted-foreground">{text}</span>}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                        st.tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                        st.tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        st.tone === "muted" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {st.text}
                    </span>
                  </button>
                  {g.opp?.slug && (
                    <div className="border-t border-border/60 px-3 py-1.5">
                      <Link
                        to="/times/$slug"
                        params={{ slug: g.opp.slug }}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-[color:var(--court)] hover:underline"
                      >
                        Ver elenco e estatísticas do time ↗
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeGame && (
        <p className="mt-8 text-sm font-medium">
          Escalando o jogo {activeGame.number}
          {activeGame.opp ? ` contra ${activeGame.opp.name}` : ""}
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[110px_1fr_1fr] bg-muted/50 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Posição</span>
          <span>Titular</span>
          <span>Reserva</span>
        </div>
        {positions.map((pos) => (
          <div
            key={pos.id}
            className="grid grid-cols-[110px_1fr_1fr] items-center gap-2 border-t border-border px-3 py-2"
          >
            <div>
              <div className="text-sm font-medium">{pos.code}</div>
              <div className="text-[11px] text-muted-foreground">{pos.name}</div>
            </div>
            {(["titular", "reserva"] as SlotType[]).map((type) => {
              const value = selection[slotKey(pos.id, type)];
              if (!editable) {
                return (
                  <div key={type} className="text-sm">
                    {value ? nameOf(value) : <span className="text-muted-foreground">—</span>}
                  </div>
                );
              }
              const opts = optionsFor(pos, type);
              const dup = duplicatas.some((d) => d.pos === pos.code);
              return (
                <Select key={type} value={value ?? NONE} onValueChange={(v) => setSlot(pos, type, v)}>
                  <SelectTrigger className={cn("w-full", dup && "border-amber-500 bg-amber-500/10")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— vazio —</SelectItem>
                    {opts.map((p) => (
                      <SelectItem key={p.player_id} value={p.player_id}>
                        {nameOf(p.player_id)}
                        <span className="ml-2 text-xs text-muted-foreground">{p.position}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })}
          </div>
        ))}
      </div>

      {editable && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => request("jogo")} disabled={saving || !activeId}>
            {saving ? "Salvando..." : multi ? `Salvar no jogo ${activeGame?.number ?? ""}`.trim() : "Salvar escalação"}
          </Button>
          {multi && (
            <Button variant="outline" onClick={() => request("todos")} disabled={saving || !activeId}>
              Aplicar a todos os jogos da semana
            </Button>
          )}
        </div>
      )}

      {editable && duplicatas.length > 0 && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          Atenção: {duplicatas.map((d) => `${d.name} (${d.pos})`).join(", ")} está como titular e reserva na
          mesma posição.
        </p>
      )}

      <AlertDialog open={dupOpen} onOpenChange={setDupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mesmo jogador como titular e reserva</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {duplicatas.map((d) => (
                  <p key={d.pos}>
                    <span className="font-medium text-foreground">{d.name}</span> está como titular e como
                    reserva em <span className="font-medium text-foreground">{d.pos}</span>.
                  </p>
                ))}
                <p>Isso é permitido, mas normalmente é engano. Quer salvar assim mesmo?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e corrigir</AlertDialogCancel>
            <AlertDialogAction onClick={() => proceed(pendingKind)}>Salvar assim mesmo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sobrescrever as escalações dos outros jogos?</AlertDialogTitle>
            <AlertDialogDescription>
              Alguns jogos da semana já têm uma escalação diferente desta. Ao aplicar a todos, a escalação
              mostrada agora substitui a deles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void persist(gameIds, selection)}>
              Aplicar a todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} className="mt-6">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      <h2 className="mt-10 font-display text-xl">Retrato da semana</h2>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {[...activePlayers, ...injured].map((p) => (
          <li
            key={p.player_id}
            className={cn(
              "flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm",
              p.status !== "active" && "text-muted-foreground line-through",
            )}
          >
            <span>{nameOf(p.player_id)}</span>
            <span className="text-xs">
              {p.position}
              {p.status !== "active" && " · lesionado"}
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-12">{children}</div>;
}
