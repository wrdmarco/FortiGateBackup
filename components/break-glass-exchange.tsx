"use client";

import { useEffect, useState } from "react";

export function BreakGlassExchange() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function exchangeToken() {
      await Promise.resolve();
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      window.history.replaceState(null, "", window.location.pathname);
      if (!token) throw new Error("Deze eenmalige link is ongeldig of verlopen.");

      try {
        const response = await fetch("/api/break-glass/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token })
        });
        const result = (await response.json()) as { redirectTo?: string; error?: string };
        if (!response.ok || !result.redirectTo) throw new Error(result.error || "De link kon niet worden geopend.");
        window.location.replace(result.redirectTo);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "De link kon niet worden geopend.");
      }
    }

    void exchangeToken().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "De link kon niet worden geopend.");
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-md border border-border bg-surface p-6 text-sm shadow-lg">
        <h1 className="text-lg font-semibold text-foreground">Hersteltoegang controleren</h1>
        <p className="mt-2 text-muted-foreground" role="status" aria-live="polite">
          {error || "De eenmalige link wordt veilig ingewisseld..."}
        </p>
      </div>
    </main>
  );
}
