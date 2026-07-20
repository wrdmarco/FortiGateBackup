"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export type FormActionState = {
  ok: boolean;
  message: string;
};

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="text-xs font-medium text-red-700 dark:text-red-300" role="alert">
      {message}
    </span>
  );
}

export function FormFeedback({
  state,
  pending = false,
  pendingMessage = "Wijzigingen verwerken...",
  className
}: {
  state: FormActionState;
  pending?: boolean;
  pendingMessage?: string;
  className?: string;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.message && !state.ok) errorRef.current?.focus();
  }, [state.message, state.ok]);

  if (pending) {
    return (
      <p
        className={clsx(
          "rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-foreground",
          className
        )}
        role="status"
        aria-live="polite"
      >
        {pendingMessage}
      </p>
    );
  }

  if (!state.message) return null;

  return (
    <p
      ref={state.ok ? undefined : errorRef}
      className={clsx(
        "rounded-md border px-3 py-2 text-sm",
        state.ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
          : "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
        className
      )}
      role={state.ok ? "status" : "alert"}
      aria-live={state.ok ? "polite" : "assertive"}
      tabIndex={state.ok ? undefined : -1}
    >
      <span className="font-semibold">{state.ok ? "Gelukt: " : "Niet gelukt: "}</span>
      {state.message}
    </p>
  );
}

export function FormSubmitButton({
  pending,
  pendingLabel,
  children,
  variant = "primary",
  className,
  disabled,
  ...props
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90",
        variant === "secondary" &&
          "border border-border bg-surface text-foreground hover:border-primary hover:text-primary",
        variant === "danger" &&
          "border border-red-700 bg-red-700 text-white hover:bg-red-800 dark:border-red-500 dark:bg-red-700 dark:hover:bg-red-600",
        className
      )}
      disabled={disabled || pending}
      aria-busy={pending}
      {...props}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
