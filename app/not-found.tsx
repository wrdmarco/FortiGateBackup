import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section aria-labelledby="not-found-title" className="w-full max-w-xl rounded-md border border-border bg-surface px-6 py-7 shadow-lg shadow-slate-950/10 sm:px-8">
        <p className="font-mono text-sm font-semibold text-primary">404</p>
        <h1 className="mt-3 text-2xl font-semibold" id="not-found-title">Pagina niet gevonden</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
          Deze route bestaat niet of is niet meer beschikbaar. Ga terug naar het dashboard om verder te werken.
        </p>
        <Link className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90" href="/">
          Naar dashboard
        </Link>
      </section>
    </main>
  );
}
