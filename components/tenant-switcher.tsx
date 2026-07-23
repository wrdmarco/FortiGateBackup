"use client";

import { useState } from "react";

type TenantOption = {
  id: string;
  name: string;
};

export function TenantSwitcher({
  tenants,
  activeTenantId,
  tenantName,
  action,
  canSwitch,
  id = "tenant-context",
  fullWidth = false
}: {
  tenants: TenantOption[];
  activeTenantId: string | null;
  tenantName: string;
  action: (formData: FormData) => void | Promise<void>;
  canSwitch: boolean;
  id?: string;
  fullWidth?: boolean;
}) {
  const [selectedTenantId, setSelectedTenantId] = useState(activeTenantId ?? "");

  if (!canSwitch) {
    return (
      <span className={`rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground ${fullWidth ? "block w-full truncate" : ""}`}>
        {tenantName}
      </span>
    );
  }

  return (
    <form action={action} className={`flex items-center gap-2 ${fullWidth ? "w-full" : ""}`}>
      <label className="sr-only" htmlFor={id}>
        Actieve tenant
      </label>
      <select
        id={id}
        className={`min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground outline-none transition hover:border-primary/45 focus:border-primary focus:ring-2 focus:ring-primary/15 ${fullWidth ? "w-full min-w-0" : ""}`}
        name="tenantId"
        value={selectedTenantId}
        onChange={(event) => {
          setSelectedTenantId(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {tenants.map((tenant) => (
          <option className="bg-surface text-foreground" key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
    </form>
  );
}
