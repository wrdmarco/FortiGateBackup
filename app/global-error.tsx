"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="nl">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <main className="grid min-h-dvh place-items-center px-4 py-10">
          <section aria-labelledby="global-error-title" className="w-full max-w-xl rounded-md border border-border bg-surface px-6 py-7 shadow-lg shadow-slate-950/10 sm:px-8">
            <p className="text-sm font-semibold text-primary">FortiGate Backup</p>
            <h1 className="mt-3 text-2xl font-semibold" id="global-error-title">Applicatie kon niet starten</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Een essentieel onderdeel is niet geladen. Probeer de applicatie opnieuw te openen. De actieve sessie blijft behouden wanneer herstel mogelijk is.
            </p>
            {error.digest ? (
              <p className="mt-4 font-mono text-xs text-muted-foreground">Referentie: {error.digest}</p>
            ) : null}
            <button
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              onClick={reset}
              type="button"
            >
              Opnieuw openen
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
