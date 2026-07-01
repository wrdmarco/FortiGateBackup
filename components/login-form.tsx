"use client";

import { useActionState } from "react";
import type { LoginState } from "@/app/actions";
import { loginAction } from "@/app/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="grid gap-5">
      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span className="font-medium text-foreground">E-mail</span>
        <input
          className="h-11 rounded-md border border-border bg-surface px-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="naam@bedrijf.nl"
          required
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium text-foreground">Wachtwoord</span>
        <input
          className="h-11 rounded-md border border-border bg-surface px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button
        className="mt-1 h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-55"
        disabled={pending}
      >
        {pending ? "Inloggen..." : "Inloggen"}
      </button>
    </form>
  );
}
