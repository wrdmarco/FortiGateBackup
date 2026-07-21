import Image from "next/image";

export default function Loading() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]" aria-busy="true" aria-label="Pagina wordt geladen">
      <aside className="hidden min-h-dvh bg-[hsl(var(--header))] lg:block">
        <div className="mx-5 my-5 flex min-h-11 items-center gap-2.5 px-1 font-mono text-[0.76rem] font-bold tracking-[0.18em] text-[hsl(var(--header-foreground))]"><Image alt="" aria-hidden height={34} src="/brand/forti-backup-mark-dark.svg" width={34}/>FORTI BACKUP</div>
        <div className="space-y-2 px-3">{[0, 1, 2, 3, 4, 5].map((item) => <div className="h-11 rounded-lg bg-white/[0.055]" key={item}/>)}</div>
      </aside>
      <div className="min-w-0">
        <div className="h-1 overflow-hidden bg-muted"><span className="block h-full w-1/3 animate-pulse rounded-r-full bg-primary"/></div>
        <header className="h-[4.5rem] border-b border-border bg-surface"/>
        <main className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 xl:px-10">
          <span className="sr-only" role="status">Pagina wordt geladen</span>
          <div className="h-8 w-56 animate-pulse rounded-md bg-muted"/><div className="mt-2 h-4 w-full max-w-md animate-pulse rounded bg-muted"/>
          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(30rem,1.1fr)]"><div className="h-72 animate-pulse rounded-[0.625rem] border border-border bg-surface"/><div className="h-72 animate-pulse rounded-[0.625rem] border border-border bg-surface"/></div>
          <div className="mt-4 h-56 animate-pulse rounded-[0.625rem] border border-border bg-surface"/>
        </main>
      </div>
    </div>
  );
}
