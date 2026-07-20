export default function Loading() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-black/30 bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))] shadow-md shadow-slate-950/10">
        <div className="mx-auto flex min-h-[4.25rem] max-w-[1440px] items-center gap-3 px-4 lg:px-6">
          <span className="grid h-11 w-11 place-items-center rounded-md bg-primary text-sm font-black text-primary-foreground">FB</span>
          <div>
            <p className="text-sm font-semibold">FortiGate Backup</p>
            <p className="text-xs text-white/60">Security operations portal</p>
          </div>
        </div>
      </header>
      <main
        aria-busy="true"
        aria-label="Pagina wordt geladen"
        className="mx-auto max-w-[1440px] px-4 py-6 lg:px-6 lg:py-8"
      >
        <span className="sr-only" role="status">Pagina wordt geladen</span>
        <div className="border-b border-border pb-5">
          <div className="h-7 w-52 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div className="h-28 animate-pulse rounded-md border border-border bg-surface" key={item} />
          ))}
        </div>
        <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
          <div className="h-12 animate-pulse border-b border-border bg-muted/70" />
          <div className="grid gap-px bg-border">
            {[0, 1, 2, 3].map((item) => (
              <div className="h-14 animate-pulse bg-surface" key={item} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
