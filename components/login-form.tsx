"use client";

import { useActionState } from "react";
import type { LoginState } from "@/app/actions";
import { loginAction } from "@/app/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      ) : null}
      <label className="grid gap-1 text-sm">
        <span className="font-medium">E-mail</span>
        <input
          className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Wachtwoord</span>
        <input
          className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Inloggen..." : "Inloggen"}
      </button>
    </form>
  );
}
