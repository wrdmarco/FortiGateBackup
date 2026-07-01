"use client";

import { useActionState, useEffect, useRef } from "react";
import { createManagedTenantWithState } from "@/app/actions";

const initialState = { ok: false, message: "" };

export function TenantCreateForm() {
  const [state, formAction, pending] = useActionState(createManagedTenantWithState, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      <TextField label="Tenantnaam" name="name" required />
      <div className="border-t border-border pt-4">
        <h3 className="mb-3 font-semibold">Eerste tenantadmin</h3>
        <div className="grid gap-4">
          <TextField label="Admin naam" name="adminName" required />
          <TextField label="Admin e-mail" name="adminEmail" type="email" required />
        </div>
        <p className="mt-3 rounded-md border border-border bg-surface-soft p-3 text-sm text-muted-foreground">
          Het tijdelijke wachtwoord wordt automatisch gegenereerd en naar de admin gemaild.
        </p>
      </div>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-300"}>
          {state.message}
        </p>
      ) : null}
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Tenant maken..." : "Tenant en admin maken"}
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
