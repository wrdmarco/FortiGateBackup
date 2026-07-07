"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function RealtimeRefresh() {
  const router = useRouter();
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const events = new EventSource("/api/events");

    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        router.refresh();
      }, 250);
    };

    events.addEventListener("refresh", scheduleRefresh);

    return () => {
      events.removeEventListener("refresh", scheduleRefresh);
      events.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return null;
}
