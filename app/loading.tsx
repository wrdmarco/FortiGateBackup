export default function Loading() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]" aria-busy="true" aria-label="Pagina wordt geladen">
      <aside className="hidden min-h-dvh bg-[hsl(var(--header))] lg:block">
        <div className="mx-5 my-6 flex items-center gap-3 text-[hsl(var(--header-foreground))]"><span className="brand-sigil"><span /></span><span><span className="block text-[0.78rem] font-bold tracking-[0.28em]">FORTI</span><span className="block text-[0.78rem] font-bold tracking-[0.2em]">BACKUP</span></span></div>
        <div className="space-y-2 px-3">{[0, 1, 2, 3, 4, 5].map((item) => <div className="h-11 rounded-lg bg-white/[0.055]" key={item}/>)}</div>
      </aside>
      <div className="min-w-0">
        <div className="h-1 overflow-hidden bg-muted"><span className="block h-full w-1/3 animate-pulse rounded-r-full bg-primary"/></div>
        <header className="h-[4.5rem] border-b border-border bg-surface"/>
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <span className="sr-only" role="status">Pagina wordt geladen</span>
          <div className="h-10 w-64 animate-pulse rounded-lg bg-muted"/><div className="mt-3 h-5 w-full max-w-md animate-pulse rounded bg-muted"/>
          <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,.75fr)]"><div className="h-80 animate-pulse rounded-xl border border-border bg-surface"/><div className="h-80 animate-pulse rounded-xl border border-border bg-surface"/></div>
          <div className="mt-5 h-64 animate-pulse rounded-xl border border-border bg-surface"/>
        </main>
      </div>
    </div>
  );
}
