"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function NavigationProgress() {
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const [pending,setPending]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{
    if(timer.current)clearTimeout(timer.current);
    const settled=setTimeout(()=>setPending(false),0);
    return()=>clearTimeout(settled);
  },[pathname,searchParams]);

  useEffect(()=>{
    const start=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const anchor=(event.target as Element|null)?.closest("a[href]") as HTMLAnchorElement|null;
      if(!anchor||anchor.target==="_blank"||anchor.hasAttribute("download"))return;
      const destination=new URL(anchor.href,window.location.href);
      if(destination.origin!==window.location.origin||destination.href===window.location.href)return;
      timer.current=setTimeout(()=>setPending(true),120);
    };
    document.addEventListener("click",start,true);
    return()=>{document.removeEventListener("click",start,true);if(timer.current)clearTimeout(timer.current);};
  },[]);

  if(!pending)return null;
  return <div className="pointer-events-none fixed inset-0 z-[90] bg-background/55 backdrop-blur-[1px]" aria-live="polite" aria-busy="true">
    <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-primary/15"><div className="navigation-progress-bar h-full w-1/3 bg-primary"/></div>
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-panel">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none"/>
        <div><p className="text-sm font-semibold">Gegevens ophalen</p><p className="text-xs text-muted-foreground">De volgende pagina wordt geladen…</p></div>
      </div>
    </div>
  </div>;
}
