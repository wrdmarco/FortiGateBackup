"use client";

import { useActionState } from "react";
import { changeOwnPasswordAction } from "@/app/actions";

const initialState = { ok: false, message: "" };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPasswordAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      <TextField label="Huidig tijdelijk wachtwoord" name="currentPassword" type="password" required />
      <TextField label="Nieuw wachtwoord" name="password" type="password" required />
      <TextField label="Nieuw wachtwoord herhalen" name="confirmPassword" type="password" required />
      {state.message ? <p className="text-sm text-red-600 dark:text-red-300">{state.message}</p> : null}
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Opslaan..." : "Wachtwoord wijzigen"}
      </button>
    </form>
  );
}

function TextField({
  label,
  name,
  type = "text",
  required = false
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input
        className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        name={name}
        type={type}
        required={required}
      />
    </label>
  );
}
