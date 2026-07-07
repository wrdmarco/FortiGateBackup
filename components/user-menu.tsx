"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function UserMenu({
  name,
  email,
  isBreakGlassSettingsOnly,
  logoutAction
}: {
  name: string | null;
  email: string;
  isBreakGlassSettingsOnly: boolean;
  logoutAction: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = name ?? email;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-10 items-center gap-2 rounded-md border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/78 transition hover:bg-white/10 hover:text-white"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-white/10 text-xs font-semibold text-white">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-40 truncate">{displayName}</span>
        <span className={open ? "rotate-180 text-white/45 transition" : "text-white/45 transition"}>v</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-xl shadow-slate-950/20" role="menu">
          <div className="border-b border-border px-3 py-3">
            <p className="truncate text-sm font-semibold">{name ?? "Gebruiker"}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
          {!isBreakGlassSettingsOnly ? (
            <>
              <Link className="block px-3 py-2 text-sm transition hover:bg-muted" href="/profile" onClick={() => setOpen(false)} role="menuitem">
                Profiel
              </Link>
              <Link className="block px-3 py-2 text-sm transition hover:bg-muted" href="/help" onClick={() => setOpen(false)} role="menuitem">
                Help
              </Link>
              <div className="border-t border-border">
                <ThemeToggle />
              </div>
            </>
          ) : null}
          <form action={logoutAction} className="border-t border-border">
            <button className="block w-full px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950" role="menuitem">
              Uitloggen
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
