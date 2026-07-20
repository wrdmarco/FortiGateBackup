"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section aria-labelledby="page-error-title" className="w-full max-w-xl rounded-md border border-border bg-surface px-6 py-7 shadow-lg shadow-slate-950/10 sm:px-8">
        <p className="text-sm font-semibold text-primary">FortiGate Backup</p>
        <h1 className="mt-3 text-2xl font-semibold" id="page-error-title">Pagina kon niet worden geladen</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
          De aanvraag is niet voltooid. Probeer de pagina opnieuw te laden. Blijft het probleem bestaan, gebruik dan de referentie bij een supportmelding.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted-foreground">Referentie: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            onClick={reset}
            type="button"
          >
            Opnieuw proberen
          </button>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-muted" href="/">
            Naar dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
