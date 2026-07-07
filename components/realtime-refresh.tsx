"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type MaintenanceState = {
  running: boolean;
  startedAt: string | null;
};

export function RealtimeRefresh() {
  const router = useRouter();
  const refreshTimer = useRef<number | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ running: false, startedAt: null });

  useEffect(() => {
    const events = new EventSource("/api/events");

    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        router.refresh();
      }, 250);
    };

    const onMaintenance = (event: MessageEvent<string>) => {
      try {
        setMaintenance(JSON.parse(event.data) as MaintenanceState);
      } catch {
        setMaintenance({ running: false, startedAt: null });
      }
    };

    events.addEventListener("refresh", scheduleRefresh);
    events.addEventListener("maintenance", onMaintenance);

    return () => {
      events.removeEventListener("refresh", scheduleRefresh);
      events.removeEventListener("maintenance", onMaintenance);
      events.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [router]);

  if (!maintenance.running) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/95 px-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-md border border-border bg-surface p-6 text-center shadow-2xl shadow-slate-950/20">
        <p className="text-sm font-semibold text-primary">FortiGate Backup Portal</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Update wordt uitgevoerd</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          De interface is tijdelijk geblokkeerd terwijl de applicatie wordt bijgewerkt. Je wordt niet naar de updatepagina gestuurd.
        </p>
        {maintenance.startedAt ? <p className="mt-4 text-xs text-muted-foreground">Gestart: {maintenance.startedAt}</p> : null}
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      </section>
    </div>
  );
}
