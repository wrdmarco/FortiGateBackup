"use client";

import { useEffect, useState } from "react";

export function SetupTokenExchange() {
  const [message, setMessage] = useState("De eenmalige setup-link wordt veilig ingewisseld...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function exchangeToken() {
      await Promise.resolve();
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      window.history.replaceState(null, "", window.location.pathname);
      if (!token) throw new Error("Deze eenmalige setup-link is ongeldig of verlopen.");

      const response = await fetch("/setup/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      const result = (await response.json()) as { redirectTo?: string; error?: string };
      if (!response.ok || !result.redirectTo) {
        throw new Error(result.error || "De setup-link kon niet worden geopend.");
      }
      window.location.replace(result.redirectTo);
    }

    void exchangeToken().catch((reason: unknown) => {
      if (!active) return;
      setFailed(true);
      setMessage(reason instanceof Error ? reason.message : "De setup-link kon niet worden geopend.");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-3 text-sm" role="status" aria-live="polite">
      <p className={failed ? "font-medium text-red-600 dark:text-red-300" : "text-muted-foreground"}>{message}</p>
      {failed ? (
        <p className="text-muted-foreground">
          Maak op de server een nieuwe link met <code>pnpm setup:link -- --base-url=https://portal.example.nl</code>.
        </p>
      ) : null}
    </div>
  );
}
