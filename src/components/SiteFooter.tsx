export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <p>
          <span className="font-display text-base text-foreground">Liga Bola Presa de Fantasy</span>
          <span className="mx-2">·</span>
          desde 2006
        </p>
        <p className="text-xs uppercase tracking-[0.2em]">NBA Fantasy League</p>
      </div>
    </footer>
  );
}
