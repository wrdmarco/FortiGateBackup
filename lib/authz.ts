import { User, UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { hasPermission, PermissionKey } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

type UserWithContext = Pick<User, "id" | "role" | "tenantId"> & {
  activeTenantId?: string | null;
};

export function isSuperAdmin(user: Pick<User, "role">) {
  return user.role === UserRole.SUPER_ADMIN;
}

export async function requireSuperAdmin(options: { allowBreakGlassSettingsOnly?: boolean } = {}) {
  const user = await requireUser(options);
  if (!isSuperAdmin(user)) notFound();
  return user;
}

export async function requireTenantUser(options: { allowBreakGlassSettingsOnly?: boolean } = {}) {
  const user = await requireUser(options);
  if (!isSuperAdmin(user) && !user.tenantId) redirect("/login");
  return user;
}

export function tenantFilter(user: UserWithContext) {
  return user.activeTenantId ?? user.tenantId ?? undefined;
}

export function assertTenantAccess(user: UserWithContext, tenantId: string | null) {
  const contextTenantId = tenantFilter(user);
  if (!tenantId || !contextTenantId || tenantId !== contextTenantId) {
    throw new Error("Geen toegang tot deze tenant binnen de actieve tenantcontext.");
  }
}

export async function assertOperationalTenant(user: UserWithContext, tenantId: string | null) {
  assertTenantAccess(user, tenantId);
  if (await isGlobalTenantId(tenantId)) {
    throw new Error("Global is een platformtenant en kan geen klanten, FortiGates of backups bevatten.");
  }
}

export async function requirePermission(permission: PermissionKey) {
  const user = await requireTenantUser();
  if (!(await hasPermission(user, permission))) notFound();
  return user;
}

export async function requireContextPermission(input: { global: PermissionKey; tenant: PermissionKey }) {
  const user = await requireTenantUser();
  const contextTenantId = tenantFilter(user) ?? user.tenantId;
  const permission = (await isGlobalTenantId(contextTenantId)) ? input.global : input.tenant;
  if (!(await hasPermission(user, permission))) notFound();
  return user;
}

export async function assertPermission(user: UserWithContext, permission: PermissionKey) {
  if (!(await hasPermission(user, permission))) {
    await auditLog({
      action: "permission.denied",
      tenantId: tenantFilter(user) ?? user.tenantId,
      userId: user.id,
      entity: "Permission",
      entityId: permission,
      outcome: "denied",
      reason: "missing_permission",
      metadata: { permission }
    });
    throw new Error("Geen toestemming voor deze actie.");
  }
}
