import { prisma } from "@/lib/db";

export async function mainTenantId() {
  const globalTenant = await prisma.tenant.findFirst({
    where: { kind: "GLOBAL" },
    select: { id: true }
  });
  return globalTenant?.id ?? null;
}

export async function isGlobalTenantId(tenantId: string | null | undefined) {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { kind: true }
  });
  return tenant?.kind === "GLOBAL";
}
