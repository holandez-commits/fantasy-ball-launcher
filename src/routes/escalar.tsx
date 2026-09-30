import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
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
const db = supabase as unknown as { from: (table: string) => any };

type Position = { id: string; code: string; name: string; sort_order: number; accepts_any: boolean };
type Lock = { id: string; season_id: string; week_number: number; locks_at: string };
type RosterRow = { player_id: string; position: string; status: string };
type SlotType = "titular" | "reserva";
type SlotRow = { position_id: string; slot_type: SlotType; player_id: string };
/** chave "<position_id>:<slot_type>" -> player_id */
type Selection = Record<string, string>;

const slotKey = (positionId: string, type: SlotType) => `${positionId}:${type}`;
const NONE = "__none";

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
 * substituição dos lineup_slots. Isolada pra reaproveitar na escalação por jogo.
 * Slots vazios simplesmente não são inseridos (salvamento parcial).
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

function EscalarPage() {
  const { ready, forbidden, teamId, isAdmin } = useRequireAuth({ role: "gm" });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [lock, setLock] = useState<Lock | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [gameIds, setGameIds] = useState<string[]>([]);
  const [gamesWithLineup, setGamesWithLineup] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>({});
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

        const [rosterRes, gamesRes] = await Promise.all([
          db
            .from("weekly_rosters")
            .select("player_id, position, status")
            .eq("team_id", teamId)
            .eq("season_id", cur.season_id)
            .eq("week_number", cur.week_number),
          db
            .from("games")
            .select("id")
            .eq("season_id", cur.season_id)
            .eq("week_number", cur.week_number)
            .eq("status", "scheduled")
            .eq("is_playoff", false)
            .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
        ]);
        if (rosterRes.error) throw new Error(rosterRes.error.message);
        if (gamesRes.error) throw new Error(gamesRes.error.message);

        const rosterRows = rosterRes.data as RosterRow[];
        setRoster(rosterRows);
        const ids = (gamesRes.data as { id: string }[]).map((g) => g.id);
        setGameIds(ids);

        const playerIds = [...new Set(rosterRows.map((r) => r.player_id))];
        if (playerIds.length > 0) {
          const pRes = await db.from("players").select("id, full_name").in("id", playerIds);
          if (pRes.error) throw new Error(pRes.error.message);
          setNames(
            Object.fromEntries((pRes.data as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])),
          );
        }

        // Escalação existente (dos meus jogos da semana).
        let sel: Selection = {};
        let withLineup: string[] = [];
        let msg: string | null = null;
        if (ids.length > 0) {
          const lRes = await db
            .from("matchup_lineups")
            .select("id, game_id")
            .eq("team_id", teamId)
            .in("game_id", ids);
          if (lRes.error) throw new Error(lRes.error.message);
          const lineups = lRes.data as { id: string; game_id: string }[];
          withLineup = lineups.map((l) => l.game_id);
          if (lineups.length > 0) {
            const sRes = await db
              .from("lineup_slots")
              .select("lineup_id, position_id, slot_type, player_id")
              .in("lineup_id", lineups.map((l) => l.id));
            if (sRes.error) throw new Error(sRes.error.message);
            const slots = sRes.data as (SlotRow & { lineup_id: string })[];
            const sigOf = (lid: string) =>
              slots
                .filter((s) => s.lineup_id === lid)
                .map((s) => `${s.position_id}:${s.slot_type}:${s.player_id}`)
                .sort()
                .join("|");
            const first = lineups.find((l) => slots.some((s) => s.lineup_id === l.id)) ?? lineups[0];
            const validIds = new Set(rosterRows.filter((r) => r.status === "active").map((r) => r.player_id));
            let dropped = 0;
            for (const s of slots.filter((x) => x.lineup_id === first.id)) {
              if (validIds.has(s.player_id)) sel[slotKey(s.position_id, s.slot_type)] = s.player_id;
              else dropped++;
            }
            const differs = new Set(lineups.map((l) => sigOf(l.id))).size > 1;
            const parts: string[] = [];
            if (differs)
              parts.push("Seus jogos da semana têm escalações diferentes; estamos mostrando a do primeiro. Salvar pode sobrescrevê-las.");
            if (dropped > 0)
              parts.push(`${dropped} slot(s) removido(s) da visualização: o jogador não está mais ativo no retrato.`);
            msg = parts.length ? parts.join(" ") : null;
          }
        }
        setSelection(sel);
        setGamesWithLineup(withLineup);
        setNotice(msg);
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
    setResult(null);
    setSelection((cur) => {
      const next = { ...cur };
      const key = slotKey(pos.id, type);
      if (playerId === NONE) delete next[key];
      else next[key] = playerId;
      return next;
    });
  }

  function buildSlots(): { slots: SlotRow[]; error: string | null } {
    const slots: SlotRow[] = [];
    const titulares = new Set<string>();
    for (const pos of positions) {
      for (const type of ["titular", "reserva"] as SlotType[]) {
        const pid = selection[slotKey(pos.id, type)];
        if (!pid) continue;
        const player = activePlayers.find((p) => p.player_id === pid);
        if (!player) return { slots, error: `${nameOf(pid)} não está ativo no seu retrato desta semana.` };
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

  async function save(scope: "existentes" | "todos") {
    if (!teamId || !lock) return;
    setResult(null);
    if (!isAdmin && now >= new Date(lock.locks_at).getTime()) {
      setForcedExpired(true);
      setResult({ ok: false, message: "Prazo encerrado para esta semana." });
      return;
    }
    const { slots, error } = buildSlots();
    if (error) {
      setResult({ ok: false, message: error });
      return;
    }
    // "Salvar" atualiza os jogos já escalados (ou todos, se ainda nenhum tem escalação).
    const targets =
      scope === "existentes" && gamesWithLineup.length > 0
        ? gameIds.filter((g) => gamesWithLineup.includes(g))
        : gameIds;
    if (targets.length === 0) {
      setResult({ ok: false, message: "Não há jogo aberto nesta semana para escalar." });
      return;
    }
    setSaving(true);
    try {
      for (const gameId of targets) await gravarEscalacaoNoJogo(gameId, teamId, slots);
      setGamesWithLineup((cur) => [...new Set([...cur, ...targets])]);
      setResult({
        ok: true,
        message: `Escalação salva em ${targets.length} jogo(s) da semana ${lock.week_number}.`,
      });
    } catch (e) {
      const { text, expired: exp } = friendlyError(e instanceof Error ? e.message : String(e));
      setResult({ ok: false, message: text });
      if (exp) {
        setForcedExpired(true);
        await load(lock.id);
      }
    } finally {
      setSaving(false);
    }
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

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Semana {lock.week_number}</p>
      <h1 className="mt-1 font-display text-3xl">Escalação</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Prazo: {deadline} (horário de Brasília). Mesma escalação para todos os jogos da semana.
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
      {!expired && gameIds.length === 0 && (
        <Alert className="mt-6">
          <AlertDescription>Não há jogo aberto nesta semana para escalar.</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mt-6">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="mt-8 overflow-hidden rounded-md border border-border">
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
              return (
                <Select key={type} value={value ?? NONE} onValueChange={(v) => setSlot(pos, type, v)}>
                  <SelectTrigger className="w-full">
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
          <Button onClick={() => void save("existentes")} disabled={saving || gameIds.length === 0}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void save("todos")}
            disabled={saving || gameIds.length === 0}
          >
            Aplicar pra semana toda
          </Button>
        </div>
      )}

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
