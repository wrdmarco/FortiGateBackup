import { User, UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { hasPermission, PermissionKey } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export function isSuperAdmin(user: Pick<User, "role">) {
  return user.role === UserRole.SUPER_ADMIN;
}

export async function requireSuperAdmin() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) notFound();
  return user;
}

export async function requireTenantUser() {
  const user = await requireUser();
  if (!isSuperAdmin(user) && !user.tenantId) redirect("/login");
  return user;
}

export function tenantFilter(user: Pick<User, "role" | "tenantId">) {
  return isSuperAdmin(user) ? undefined : user.tenantId;
}

export function assertTenantAccess(user: Pick<User, "role" | "tenantId">, tenantId: string | null) {
  if (isSuperAdmin(user)) return;
  if (!tenantId || tenantId !== user.tenantId) {
    throw new Error("Geen toegang tot deze tenant.");
  }
}

export async function requirePermission(permission: PermissionKey) {
  const user = await requireTenantUser();
  if (!(await hasPermission(user, permission))) notFound();
  return user;
}

export async function assertPermission(user: Pick<User, "id" | "role" | "tenantId">, permission: PermissionKey) {
  if (!(await hasPermission(user, permission))) {
    throw new Error("Geen toestemming voor deze actie.");
  }
}
