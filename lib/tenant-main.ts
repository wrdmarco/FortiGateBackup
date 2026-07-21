import { prisma } from "@/lib/db";
import { cache } from "react";

export const mainTenantId = cache(async function mainTenantId() {
  const globalTenant = await prisma.tenant.findFirst({
    where: { kind: "GLOBAL" },
    select: { id: true }
  });
  return globalTenant?.id ?? null;
});

export const isGlobalTenantId = cache(async function isGlobalTenantId(tenantId: string | null | undefined) {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { kind: true }
  });
  return tenant?.kind === "GLOBAL";
});
