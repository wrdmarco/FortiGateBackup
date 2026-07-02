"use client";

import { useEffect, useState } from "react";

type TenantOption = {
  id: string;
  name: string;
};

export function TenantSwitcher({
  tenants,
  activeTenantId,
  tenantName,
  action,
  canSwitch
}: {
  tenants: TenantOption[];
  activeTenantId: string | null;
  tenantName: string;
  action: (formData: FormData) => void | Promise<void>;
  canSwitch: boolean;
}) {
  const [selectedTenantId, setSelectedTenantId] = useState(activeTenantId ?? "");

  useEffect(() => {
    setSelectedTenantId(activeTenantId ?? "");
  }, [activeTenantId]);

  if (!canSwitch) {
    return (
      <span className="rounded-md border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72">
        {tenantName}
      </span>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <label className="sr-only" htmlFor="tenant-context">
        Actieve tenant
      </label>
      <select
        id="tenant-context"
        className="min-h-10 rounded-md border border-white/12 bg-[hsl(var(--header))] px-3 py-2 text-sm font-medium text-[hsl(var(--header-foreground))] outline-none transition hover:border-white/25 hover:bg-white/[0.08] focus:border-primary focus:bg-[hsl(var(--header))]"
        name="tenantId"
        value={selectedTenantId}
        onChange={(event) => {
          setSelectedTenantId(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {tenants.map((tenant) => (
          <option className="bg-[hsl(var(--surface))] text-[hsl(var(--foreground))]" key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
    </form>
  );
}
