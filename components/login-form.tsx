"use client";

import { useActionState, useState } from "react";
import type { LoginState } from "@/app/actions";
import { loginAction } from "@/app/actions";

const initialState: LoginState = {};

export function LoginForm({ ssoAvailable = false, externalError }: { ssoAvailable?: boolean; externalError?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState("");
  const [ssoPending, setSsoPending] = useState(false);
  const error = state.error ?? externalError;

  return (
    <div className="grid gap-6">
      {error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          role="alert"
          aria-live="polite"
        >
          {error}
        </div>
      ) : null}
      <form action={formAction} className="grid gap-5">
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-foreground">E-mail</span>
          <input
            className="h-12 rounded-lg border border-border bg-surface px-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="naam@bedrijf.nl"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-foreground">Wachtwoord</span>
          <input
            className="h-12 rounded-lg border border-border bg-surface px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button
          className="mt-1 h-12 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-55"
          disabled={pending || ssoPending}
        >
          {pending ? "Inloggen..." : "Inloggen"}
        </button>
      </form>

      {ssoAvailable ? (
        <>
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase text-muted-foreground">of</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <form action="/api/auth/entra/start" method="post" onSubmit={() => setSsoPending(true)}>
            <input name="email" type="hidden" value={email} />
            <button
              className="h-12 w-full rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:border-primary/60 hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-primary/25 focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-55"
              disabled={pending || ssoPending || !email.trim()}
              type="submit"
            >
              {ssoPending ? "Doorsturen naar Microsoft..." : "Inloggen met Microsoft"}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
