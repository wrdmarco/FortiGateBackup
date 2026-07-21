"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UpdateOutcome = "idle" | "running" | "success" | "error";

type UpdateSnapshot = {
  source: "application" | "maintenance";
  running: boolean;
  done: boolean;
  outcome: UpdateOutcome;
  operation: "update" | "rollback";
  startedAt: string | null;
  finishedAt: string | null;
  isStarter: boolean;
  returnTo: string;
  log: string | null;
};

const returnToKey = "fgbp-update-return-to";

export function UpdateRuntimeObserver() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  useUpdateChannel(null, setSnapshot);

  if (!snapshot?.running && snapshot?.source !== "maintenance") return null;
  return <UpdateView snapshot={snapshot} overlay />;
}

export function UpdateMaintenanceScreen({
  isStarter,
  returnTo,
  initialLog,
  startedAt,
  outcome = "running",
  operation = "update"
}: {
  isStarter: boolean;
  returnTo: string;
  initialLog: string | null;
  startedAt: string | null;
  outcome?: UpdateOutcome;
  operation?: "update" | "rollback";
}) {
  const initialSnapshot = useMemo<UpdateSnapshot>(
    () => ({
      source: "application",
      running: outcome === "running",
      done: outcome !== "running",
      outcome,
      operation,
      startedAt,
      finishedAt: null,
      isStarter,
      returnTo: safeReturnTo(returnTo),
      log: isStarter ? initialLog : null
    }),
    [initialLog, isStarter, operation, outcome, returnTo, startedAt]
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  useUpdateChannel(initialSnapshot, setSnapshot);
  return <UpdateView snapshot={snapshot} />;
}

function useUpdateChannel(
  initialSnapshot: UpdateSnapshot | null,
  setSnapshot: (snapshot: UpdateSnapshot) => void
) {
  const hadMaintenance = useRef(Boolean(initialSnapshot?.running));
  const redirecting = useRef(false);
  const [pollFallback, setPollFallback] = useState(false);

  useEffect(() => {
    rememberReturnTo(initialSnapshot?.isStarter ? initialSnapshot.returnTo : undefined);
    const events = new EventSource("/api/update/events");

    const apply = (next: UpdateSnapshot) => {
      if (next.running) {
        hadMaintenance.current = true;
        rememberReturnTo(next.isStarter ? next.returnTo : undefined);
        setSnapshot(next);
        return;
      }

      if (!hadMaintenance.current) return;
      setSnapshot(next);
      if (next.source === "application") redirectToLastPage(next, redirecting);
    };

    const onMessage = (event: MessageEvent<string>) => {
      const next = parseSnapshot(event.data);
      if (next) apply(next);
    };

    events.addEventListener("snapshot", onMessage);
    events.addEventListener("done", onMessage);
    events.onopen = () => setPollFallback(false);
    events.onerror = () => setPollFallback(true);

    return () => {
      events.removeEventListener("snapshot", onMessage);
      events.removeEventListener("done", onMessage);
      events.close();
    };
  }, [initialSnapshot?.isStarter, initialSnapshot?.returnTo, setSnapshot]);

  useEffect(() => {
    if (!pollFallback && !hadMaintenance.current) return;
    let cancelled = false;
    let timer: number | null = null;
    let delay = 1000;

    const poll = async () => {
      try {
        const response = await fetch(`/api/update/events?poll=1&t=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error("status unavailable");
        const next = parseSnapshot(await response.text());
        if (next) {
          delay = 1000;
          if (next.running) {
            hadMaintenance.current = true;
            rememberReturnTo(next.isStarter ? next.returnTo : undefined);
            setSnapshot(next);
          } else if (hadMaintenance.current) {
            setSnapshot(next);
            if (next.source === "application") redirectToLastPage(next, redirecting);
          }
        }
      } catch {
        delay = Math.min(5000, Math.round(delay * 1.6));
      } finally {
        if (!cancelled && !redirecting.current) timer = window.setTimeout(poll, delay);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollFallback, setSnapshot]);
}

function UpdateView({ snapshot, overlay = false }: { snapshot: UpdateSnapshot; overlay?: boolean }) {
  const logRef = useRef<HTMLPreElement | null>(null);
  const isError = snapshot.outcome === "error" && snapshot.source === "maintenance";
  const isDone = snapshot.done && snapshot.source === "application";
  const startedLabel = useMemo(() => formatDateTime(snapshot.startedAt), [snapshot.startedAt]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snapshot.log]);

  const title = isError
    ? "De portal blijft veilig in onderhoud"
    : isDone
      ? "De portal is weer beschikbaar"
      : snapshot.operation === "rollback"
        ? "Een eerdere versie wordt hersteld"
        : "De portal wordt veilig bijgewerkt";
  const description = isError
    ? "De update kon niet volledig worden afgerond. De onderhoudsinterface blijft beschikbaar terwijl de beheerder het herstel uitvoert."
    : isDone
      ? "Je laatste pagina wordt automatisch hersteld."
      : "De interface is tijdelijk gepauzeerd. Backups en instellingen blijven beschermd tijdens deze onderhoudsactie.";

  return (
    <main
      className={`${overlay ? "fixed inset-0 z-[200] overflow-y-auto" : "min-h-dvh"} bg-background text-foreground`}
      aria-busy={!isDone}
    >
      <header className="border-b border-border bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))]">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <span className="brand-sigil brand-sigil-small !border-white/25 !text-white" aria-hidden="true"><span /></span>
          <span className="text-xs font-bold tracking-[0.18em]">FORTI BACKUP</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {isError ? "Herstelstatus" : "Gepland onderhoud"}
        </p>
        <h1 className="font-display mt-3 max-w-4xl text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>

        <section className="mt-10 grid gap-6 border-t border-border pt-7 md:grid-cols-[minmax(0,1fr)_300px]" aria-live="polite">
          <div>
            <div className="h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-label="Onderhoudsstatus">
              <span
                className={`block h-full rounded ${isError ? "w-full bg-danger" : isDone ? "w-full bg-success" : "w-2/5 animate-pulse bg-primary"}`}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span>{snapshot.source === "application" ? "Applicatieverbinding actief" : "Onderhoudsverbinding actief"}</span>
              {startedLabel ? <time dateTime={snapshot.startedAt ?? undefined}>Gestart: {startedLabel}</time> : null}
            </div>
          </div>

          <div className={`border-l-2 pl-4 ${isError ? "border-danger" : isDone ? "border-success" : "border-primary"}`}>
            <p className="text-sm font-semibold">{isError ? "Herstel wordt afgewacht" : isDone ? "Onderhoud afgerond" : "Onderhoud in uitvoering"}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {isError
                ? "Deze pagina blijft automatisch controleren wanneer de portal weer beschikbaar is."
                : "Je hoeft niets te vernieuwen. Je laatste veilige pagina opent automatisch zodra de portal gereed is."}
            </p>
          </div>
        </section>

        {snapshot.isStarter ? (
          <section className="mt-8 overflow-hidden rounded-xl border border-border bg-[hsl(var(--header))] text-slate-100 shadow-panel" aria-label="Live update log">
            <div className="flex items-center justify-between gap-4 border-b border-white/15 px-4 py-3">
              <h2 className="text-sm font-semibold">Live update log</h2>
              <span className={`text-xs font-medium ${isError ? "text-red-300" : isDone ? "text-emerald-300" : "text-cyan-300"}`}>
                {isError ? "Onderbroken" : isDone ? "Afgerond" : "Live"}
              </span>
            </div>
            <pre ref={logRef} className="max-h-[45dvh] min-h-64 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-slate-200">
              {snapshot.log || "Wachten op update-output..."}
            </pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function parseSnapshot(raw: string): UpdateSnapshot | null {
  try {
    const value = JSON.parse(raw) as Partial<UpdateSnapshot>;
    if (typeof value.running !== "boolean" || (value.source !== "application" && value.source !== "maintenance")) return null;
    return {
      source: value.source,
      running: value.running,
      done: !value.running,
      outcome: value.outcome === "success" || value.outcome === "error" || value.outcome === "running" ? value.outcome : "idle",
      operation: value.operation === "rollback" ? "rollback" : "update",
      startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
      finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
      isStarter: value.isStarter === true,
      returnTo: safeReturnTo(value.returnTo),
      log: typeof value.log === "string" ? value.log : null
    };
  } catch {
    return null;
  }
}

function rememberReturnTo(preferred?: string) {
  const current = safeReturnTo(`${window.location.pathname}${window.location.search}`);
  const candidate = preferred && safeReturnTo(preferred) !== "/" ? safeReturnTo(preferred) : current;
  if (!candidate.startsWith("/api/") && !window.sessionStorage.getItem(returnToKey)) {
    window.sessionStorage.setItem(returnToKey, candidate);
  }
}

function redirectToLastPage(snapshot: UpdateSnapshot, redirecting: React.MutableRefObject<boolean>) {
  if (redirecting.current) return;
  redirecting.current = true;
  const stored = window.sessionStorage.getItem(returnToKey);
  const target = snapshot.isStarter && safeReturnTo(snapshot.returnTo) !== "/" ? safeReturnTo(snapshot.returnTo) : safeReturnTo(stored);
  window.sessionStorage.removeItem(returnToKey);
  window.setTimeout(() => window.location.replace(target), 500);
}

function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
