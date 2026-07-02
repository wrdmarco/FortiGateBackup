"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTenantUserWithState } from "@/app/actions";

const initialState = { ok: false, message: "" };

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
};

export function TenantUserCreateForm({ tenantId, roles }: { tenantId: string; roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(createTenantUserWithState, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="mt-3 grid gap-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Naam" name="name" />
        <Field label="E-mail" name="email" type="email" required />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Rol</span>
          <select className="rounded-md border border-border bg-surface px-3 py-2" name="roleId" required>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            De gebruiker krijgt exact de geselecteerde RBAC-rol binnen deze tenant.
          </span>
        </label>
        <div className="rounded-md border border-border bg-surface-soft p-3 text-sm text-muted-foreground">
          Er wordt automatisch een tijdelijk wachtwoord gegenereerd en per mail verstuurd. De gebruiker moet dit bij de eerste login wijzigen.
        </div>
      </div>
      {roles.length ? (
        <div className="rounded-md border border-border bg-surface-soft p-3 text-sm text-muted-foreground">
          {roles.map((role) => (
            <div key={role.id}>
              <span className="font-medium text-foreground">{role.name}</span>
              {role.description ? ` - ${role.description}` : null}
            </div>
          ))}
        </div>
      ) : null}
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-300"}>
          {state.message}
        </p>
      ) : null}
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Gebruiker toevoegen..." : "Gebruiker toevoegen"}
      </button>
    </form>
  );
}

function Field({
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
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        name={name}
        type={type}
        required={required}
      />
    </label>
  );
}
