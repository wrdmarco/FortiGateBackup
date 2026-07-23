"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isInternalPageNavigation } from "@/lib/navigation-intent";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const settled = setTimeout(() => setPending(false), 0);
    return () => clearTimeout(settled);
  }, [routeKey]);

  useEffect(() => {
    const start = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !isInternalPageNavigation({
        href: anchor.href,
        currentHref: window.location.href,
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download")
      })) return;
      setPending(true);
    };
    const settle = () => setPending(false);
    document.addEventListener("click", start, true);
    window.addEventListener("pageshow", settle);
    return () => {
      document.removeEventListener("click", start, true);
      window.removeEventListener("pageshow", settle);
    };
  }, []);

  if (!pending) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] bg-background/55 backdrop-blur-[1px]" aria-live="polite" aria-busy="true">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-primary/15">
        <div className="navigation-progress-bar h-full w-1/3 bg-primary" />
      </div>
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-panel">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" />
          <div>
            <p className="text-sm font-semibold">Gegevens ophalen</p>
            <p className="text-xs text-muted-foreground">De volgende pagina wordt geladen...</p>
          </div>
        </div>
      </div>
    </div>
  );
}
