import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function mainTenantId() {
  const firstSuperAdmin = await prisma.user.findFirst({
    where: { role: UserRole.SUPER_ADMIN, tenantId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { tenantId: true }
  });
  if (firstSuperAdmin?.tenantId) return firstSuperAdmin.tenantId;

  const firstTenant = await prisma.tenant.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true }
  });
  return firstTenant?.id ?? null;
}

export async function isGlobalTenantId(tenantId: string | null | undefined) {
  if (!tenantId) return false;
  const mainTenant = await mainTenantId();
  if (tenantId === mainTenant) return true;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true }
  });
  const labels = [tenant?.name, tenant?.slug].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  return labels.some((value) => value === "global" || value === "globaal");
}
