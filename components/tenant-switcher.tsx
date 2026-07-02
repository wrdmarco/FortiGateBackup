"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedTenantId, setSelectedTenantId] = useState(activeTenantId ?? "");
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

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
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="sr-only" htmlFor="tenant-context">
        Actieve tenant
      </label>
      <select
        id="tenant-context"
        className="min-h-10 rounded-md border border-white/12 bg-[hsl(var(--header))] px-3 py-2 text-sm font-medium text-white/80 outline-none transition hover:bg-white/10 focus:border-primary"
        name="tenantId"
        value={selectedTenantId}
        onChange={(event) => {
          setSelectedTenantId(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
    </form>
  );
}
