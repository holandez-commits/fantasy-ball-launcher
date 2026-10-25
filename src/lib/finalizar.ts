// Server fns e helpers compartilhados entre /admin/resultados e a tela do confronto
// (botão "Fechar partida"). Nada aqui grava: gravar é a RPC finalizar_confronto,
// que confere has_role('admin') no banco.
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  serverClient,
  prepareFinalizacao,
  placaresAoVivo,
  type PrepareResult,
  type LivePlacar,
} from "@/lib/confronto-server";

// Lê a planilha (leitura fresca), resolve nomes e monta o payload — NÃO grava.
export const prepararFn = createServerFn({ method: "POST" })
  .inputValidator((gameId: string) => gameId)
  .handler(async ({ data: gameId }): Promise<PrepareResult> => {
    // data de hoje em horário de Brasília (Worker roda em UTC)
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    return prepareFinalizacao(serverClient(), gameId, hoje);
  });

// Placar + jogadores restantes por time, em lote (usa o cache de ~25s da planilha).
export const restantesFn = createServerFn({ method: "POST" })
  .inputValidator((gameIds: string[]) => gameIds)
  .handler(async ({ data }): Promise<LivePlacar[]> => placaresAoVivo(serverClient(), data));

// RPCs admin (tipagem frouxa — não estão no types.ts)
export const callRpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);
