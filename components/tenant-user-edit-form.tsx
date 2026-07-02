"use client";

import { useActionState } from "react";
import { updateTenantUserWithState } from "@/app/actions";

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
};

type UserValue = {
  id: string;
  name: string | null;
  email: string;
  roleId: string;
};

const initialState = { ok: false, message: "" };

export function TenantUserEditForm({ user, roles }: { user: UserValue; roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(updateTenantUserWithState, initialState);

  return (
    <form action={formAction} className="grid gap-4 rounded-md border border-border bg-surface-soft p-4">
      <input type="hidden" name="id" value={user.id} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Naam</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="name"
            defaultValue={user.name ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">E-mail</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="email"
            type="email"
            required
            defaultValue={user.email}
          />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Rol</span>
        <select className="rounded-md border border-border bg-surface px-3 py-2" name="roleId" defaultValue={user.roleId} required>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-300"}>
          {state.message}
        </p>
      ) : null}
      <button
        className="inline-flex min-h-10 w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={pending}
      >
        {pending ? "Opslaan..." : "Gebruiker opslaan"}
      </button>
    </form>
  );
}
