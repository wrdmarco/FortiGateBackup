"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAccessRoleWithState } from "@/app/actions";

type PermissionItem = {
  key: string;
  category: string;
  description: string;
};

const initialState = { ok: false, message: "" };

export function RoleCreateForm({
  tenantId,
  groupedPermissions
}: {
  tenantId: string;
  groupedPermissions: [string, PermissionItem[]][];
}) {
  const [state, formAction, pending] = useActionState(createAccessRoleWithState, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-6">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Rolnaam</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="name"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Omschrijving</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="description"
          />
        </label>
      </div>
      <div className="grid gap-3">
        {groupedPermissions.map(([category, items]) => (
          <fieldset key={category} className="rounded-xl border border-border bg-surface-soft p-4">
            <legend className="px-1 text-sm font-semibold">{category}</legend>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {items.map((permission) => (
                <label key={permission.key} className="flex gap-3 rounded-lg border border-border bg-surface p-3 text-xs transition hover:border-primary/40">
                  <input className="mt-0.5" name="permissionKeys" type="checkbox" value={permission.key} />
                  <span>
                    <span className="block font-mono">{permission.key}</span>
                    <span className="mt-1 block text-muted-foreground">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-300"}>
          {state.message}
        </p>
      ) : null}
      <button
        className="inline-flex min-h-10 w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Rol aanmaken..." : "Rol aanmaken"}
      </button>
    </form>
  );
}
