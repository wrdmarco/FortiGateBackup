"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UpdateSnapshot = {
  running: boolean;
  done: boolean;
  returnTo: string;
  log: string | null;
};

export function UpdateMaintenanceScreen({
  isStarter,
  returnTo,
  initialLog,
  startedAt
}: {
  isStarter: boolean;
  returnTo: string;
  initialLog: string | null;
  startedAt: string | null;
}) {
  const [log, setLog] = useState(initialLog ?? "");
  const [done, setDone] = useState(false);
  const [connectionState, setConnectionState] = useState<"live" | "connecting" | "reconnecting">("connecting");
  const logRef = useRef<HTMLPreElement | null>(null);
  const safeReturnTo = useMemo(() => (returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"), [returnTo]);

  useEffect(() => {
    if (!isStarter) return;
    const events = new EventSource("/api/update/events");

    const onSnapshot = (event: MessageEvent<string>) => {
      const snapshot = JSON.parse(event.data) as UpdateSnapshot;
      setConnectionState("live");
      if (snapshot.log !== null) setLog(snapshot.log);
      if (snapshot.done || !snapshot.running) {
        setDone(true);
        window.setTimeout(() => {
          window.location.assign(snapshot.returnTo || safeReturnTo);
        }, 1200);
      }
    };

    events.addEventListener("snapshot", onSnapshot);
    events.addEventListener("done", onSnapshot);
    events.onerror = () => setConnectionState("reconnecting");

    return () => {
      events.removeEventListener("snapshot", onSnapshot);
      events.removeEventListener("done", onSnapshot);
      events.close();
    };
  }, [isStarter, safeReturnTo]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-5xl items-center">
        <section className="w-full overflow-hidden rounded-md border border-border bg-surface shadow-xl shadow-slate-950/10">
          <div className="border-b border-border bg-[hsl(var(--header))] px-5 py-4 text-[hsl(var(--header-foreground))]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">FortiGate Backup Portal</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Applicatie update wordt uitgevoerd</h1>
              </div>
              <span className="rounded-md border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-sm font-semibold text-amber-100">
                Interface tijdelijk niet beschikbaar
              </span>
            </div>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-surface-soft p-4">
                <p className="text-sm text-muted-foreground">
                  De portal wordt bijgewerkt. Openstaande acties zijn tijdelijk geblokkeerd zodat data en migraties schoon blijven.
                </p>
                {startedAt ? <p className="mt-3 text-xs text-muted-foreground">Gestart: {startedAt}</p> : null}
              </div>

              {isStarter ? (
                <div className="rounded-md border border-border bg-slate-950 text-slate-100 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold">Live update log</h2>
                      <p className="text-xs text-slate-400">Je wordt automatisch teruggestuurd zodra de update klaar is.</p>
                    </div>
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                      {done ? "Afgerond" : connectionState === "live" ? "Live" : "Verbinden"}
                    </span>
                  </div>
                  <pre ref={logRef} className="max-h-[52dvh] min-h-72 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5">
                    {log || "Wachten op update-output..."}
                  </pre>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-surface-soft p-4">
                  <h2 className="text-sm font-semibold">Update in uitvoering</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    De live log is alleen zichtbaar voor de gebruiker die de update heeft gestart. Deze pagina kan blijven staan; ververs na enkele minuten opnieuw.
                  </p>
                </div>
              )}
            </div>

            <aside className="grid content-start gap-3 rounded-md border border-border bg-surface-soft p-4">
              <StatusStep label="Update gestart" active />
              <StatusStep label="Applicatie wordt bijgewerkt" active={!done} />
              <StatusStep label="Terug naar laatste pagina" active={done} />
              <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
                Doel na afronden: <span className="font-medium text-foreground">{safeReturnTo}</span>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusStep({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={active ? "h-2.5 w-2.5 rounded-full bg-primary" : "h-2.5 w-2.5 rounded-full bg-muted-foreground/35"} />
      <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
