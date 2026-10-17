import { cn } from "@/lib/utils";

/**
 * Banner do estado do mercado. Presentacional: recebe `isOpen` (o pai já busca).
 *   - null  = ainda não sabemos (ou sem linha em market_state) -> não renderiza.
 *   - true  = ABERTO  (Seg->Qua): troca/dispensa aprovadas executam na hora.
 *   - false = FECHADO (Qua->Dom): lances de FA abertos; o que o admin aprovar
 *             fica na fila e é aplicado na consolidação de domingo.
 */
export function MarketStateBanner({ isOpen }: { isOpen: boolean | null }) {
  if (isOpen === null) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm",
        isOpen
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <div className="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            isOpen ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
        {isOpen ? "Mercado aberto" : "Mercado fechado"}
      </div>
      <p className="text-[13px] opacity-90">
        {isOpen
          ? "Trocas e dispensas aprovadas pelo admin são aplicadas na hora."
          : "Período de lances de free agency. Trocas e dispensas aprovadas ficam na fila e são aplicadas na consolidação de domingo."}
      </p>
    </div>
  );
}
