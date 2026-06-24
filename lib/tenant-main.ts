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