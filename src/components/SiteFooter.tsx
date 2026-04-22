export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-muted/30">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <p>
          <span className="font-display text-base text-foreground">Liga Bola Presa de Fantasy</span>
          <span className="mx-2">·</span>
          desde 2006
        </p>
        <p className="text-[11px] uppercase tracking-[0.25em]">NBA Fantasy League</p>
      </div>
    </footer>
  );
}
