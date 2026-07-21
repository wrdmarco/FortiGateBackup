"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function Modal({
  title,
  description,
  trigger,
  children,
  defaultOpen = false,
  size = "default"
}: {
  title: string;
  description?: string;
  trigger: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  size?: "default" | "wide";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const openDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }, []);

  const closeDialog = useCallback(() => {
    if (dialogRef.current?.open) dialogRef.current.close();
  }, []);

  useEffect(() => {
    if (defaultOpen) openDialog();
  }, [defaultOpen, openDialog]);

  function restoreTriggerFocus() {
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true"
    );
    const first = focusable[0];
    const last = focusable.at(-1);

    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <span className="contents" onClick={(event) => !event.defaultPrevented && openDialog()}>
        {trigger}
      </span>
      <dialog
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-dialog security-panel professional-surface m-auto overflow-hidden rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl ${size === "wide" ? "w-[min(94vw,1040px)]" : "w-[min(94vw,720px)]"}`}
        id={dialogId}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        onClose={restoreTriggerFocus}
        onKeyDown={trapFocus}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="border-b border-border bg-surface-soft/70 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-primary">Forti Backup</p>
              <h2 className="font-display text-xl font-semibold tracking-[-0.008em] sm:text-2xl" id={titleId}>
                {title}
              </h2>
              {description ? (
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground" id={descriptionId}>
                  {description}
                </p>
              ) : null}
            </div>
            <button
              aria-label="Dialoog sluiten"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-xl leading-none text-muted-foreground transition hover:border-primary/45 hover:bg-muted hover:text-foreground"
              onClick={closeDialog}
              ref={closeButtonRef}
              title="Sluiten"
              type="button"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        </div>
        <div className="modal-content max-h-[min(78dvh,48rem)] overscroll-contain overflow-y-auto p-5 sm:p-7">{children}</div>
      </dialog>
    </>
  );
}

export function AppNavLink({
  href,
  children,
  className = ""
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const targetPath = href.split(/[?#]/, 1)[0] || "/";
  const isCurrent = targetPath === "/" ? pathname === "/" : pathname === targetPath || pathname.startsWith(`${targetPath}/`);

  return (
    <Link
      aria-current={isCurrent ? "page" : undefined}
      className={`app-nav-link ${className}`}
      href={href}
    >
      {children}
    </Link>
  );
}

type ThemeMode = "light" | "dark";

export function HeaderUserMenu({
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
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, serverTheme);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const displayName = name ?? email;

  useEffect(() => {
    if (!open) return;

    function closeFromOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  function chooseTheme(nextTheme: ThemeMode) {
    window.localStorage.setItem("fgbp-theme", nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event("fgbp-theme-change"));
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={`Gebruikersmenu voor ${displayName}`}
        className="flex min-h-11 max-w-[11rem] items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm font-semibold text-foreground transition hover:bg-muted sm:max-w-52 sm:px-3"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[hsl(var(--header))] text-xs font-semibold text-[hsl(var(--header-foreground))]">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden min-w-0 truncate sm:block">{displayName}</span>
        <span
          aria-hidden="true"
          className={`ml-auto h-2 w-2 shrink-0 rotate-45 border-b border-r border-current opacity-55 transition-transform ${open ? "-translate-y-0.5 rotate-[225deg]" : ""}`}
        />
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-xl shadow-slate-950/25"
          id={menuId}
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold">{name ?? "Gebruiker"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
          </div>
          {!isBreakGlassSettingsOnly ? (
            <>
              <nav aria-label="Gebruikersopties" className="grid p-1.5">
                <Link className="flex min-h-11 items-center rounded px-3 py-2 text-sm transition hover:bg-muted" href="/profile" onClick={() => setOpen(false)}>
                  Profiel
                </Link>
                <Link className="flex min-h-11 items-center rounded px-3 py-2 text-sm transition hover:bg-muted" href="/help" onClick={() => setOpen(false)}>
                  Help
                </Link>
              </nav>
              <div className="border-t border-border px-3 py-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Weergave</p>
                <div aria-label="Kleurmodus" className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1" role="group">
                  <button
                    aria-pressed={theme === "light"}
                    className={theme === "light" ? activeThemeClass : inactiveThemeClass}
                    onClick={() => chooseTheme("light")}
                    type="button"
                  >
                    Licht
                  </button>
                  <button
                    aria-pressed={theme === "dark"}
                    className={theme === "dark" ? activeThemeClass : inactiveThemeClass}
                    onClick={() => chooseTheme("dark")}
                    type="button"
                  >
                    Donker
                  </button>
                </div>
              </div>
            </>
          ) : null}
          <form action={logoutAction} className="border-t border-border p-1.5">
            <button className="flex min-h-11 w-full items-center rounded px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950" type="submit">
              Uitloggen
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function serverTheme(): ThemeMode {
  return "light";
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("fgbp-theme-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("fgbp-theme-change", onChange);
  };
}

const activeThemeClass = "min-h-11 rounded bg-surface px-3 py-2 text-sm font-semibold text-foreground shadow-sm";
const inactiveThemeClass = "min-h-11 rounded px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground";
