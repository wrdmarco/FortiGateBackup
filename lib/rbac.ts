import { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mainTenantId } from "@/lib/tenant-main";

export const permissions = [
  { key: "platform.dashboard.read", category: "Platform", description: "Platformbreed dashboard bekijken" },
  { key: "platform.tenants.read", category: "Platform", description: "Alle tenants bekijken" },
  { key: "platform.tenants.create", category: "Platform", description: "Nieuwe tenants aanmaken" },
  { key: "platform.tenants.update", category: "Platform", description: "Tenantstatus en tenantgegevens wijzigen" },
  { key: "platform.tenants.delete", category: "Platform", description: "Tenants verwijderen" },
  { key: "platform.tenants.export", category: "Platform", description: "Tenantdata exporteren" },
  { key: "platform.tenants.restore", category: "Platform", description: "Tenantdata herstellen of als nieuwe tenant importeren" },
  { key: "platform.tenants.switch", category: "Platform", description: "Een tenantcontext openen via de tenantwisselaar" },
  { key: "platform.users.read", category: "Platform", description: "Platformbreed gebruikers bekijken" },
  { key: "platform.users.create", category: "Platform", description: "Gebruikers voor tenants aanmaken" },
  { key: "platform.users.update", category: "Platform", description: "Platformbreed gebruikers wijzigen" },
  { key: "platform.users.delete", category: "Platform", description: "Platformbreed gebruikers verwijderen" },
  { key: "platform.roles.read", category: "Platform", description: "Platformrollen en permission catalogus bekijken" },
  { key: "platform.roles.create", category: "Platform", description: "Platformrollen aanmaken" },
  { key: "platform.roles.update", category: "Platform", description: "Platformrollen wijzigen" },
  { key: "platform.roles.delete", category: "Platform", description: "Platformrollen verwijderen" },
  { key: "platform.super_admin.assign", category: "Platform", description: "De Super Admin-rol toekennen of intrekken" },
  { key: "platform.settings.read", category: "Platform", description: "Globale applicatie-instellingen bekijken" },
  { key: "platform.settings.update", category: "Platform", description: "Globale applicatie-instellingen wijzigen" },
  { key: "platform.updates.read", category: "Platform", description: "Applicatie-update status bekijken" },
  { key: "platform.updates.run", category: "Platform", description: "Applicatie-update starten" },
  { key: "platform.audit.read", category: "Platform", description: "Platformbrede auditlogs bekijken" },
  { key: "platform.health.read", category: "Platform", description: "Healthchecks en systeemstatus bekijken" },
  { key: "platform.version.read", category: "Platform", description: "Applicatieversie en Git commit bekijken" },
  { key: "tenant.dashboard.read", category: "Tenant", description: "Tenant dashboard bekijken" },
  { key: "tenant.users.read", category: "Tenant", description: "Gebruikers binnen tenant bekijken" },
  { key: "tenant.users.create", category: "Tenant", description: "Tenantgebruikers aanmaken" },
  { key: "tenant.users.update", category: "Tenant", description: "Tenantgebruikers wijzigen" },
  { key: "tenant.users.delete", category: "Tenant", description: "Tenantgebruikers verwijderen" },
  { key: "tenant.roles.read", category: "Tenant", description: "Rollen bekijken" },
  { key: "tenant.roles.create", category: "Tenant", description: "Rollen aanmaken" },
  { key: "tenant.roles.update", category: "Tenant", description: "Rollen wijzigen" },
  { key: "tenant.roles.delete", category: "Tenant", description: "Rollen verwijderen" },
  { key: "tenant.settings.read", category: "Tenant", description: "Tenantinstellingen bekijken" },
  { key: "tenant.settings.update", category: "Tenant", description: "Tenantinstellingen wijzigen" },
  { key: "customers.read", category: "Klanten", description: "Klanten bekijken" },
  { key: "customers.create", category: "Klanten", description: "Klanten aanmaken" },
  { key: "customers.update", category: "Klanten", description: "Klanten wijzigen" },
  { key: "customers.delete", category: "Klanten", description: "Klanten verwijderen" },
  { key: "fortigates.read", category: "FortiGates", description: "FortiGates bekijken" },
  { key: "fortigates.create", category: "FortiGates", description: "FortiGates toevoegen" },
  { key: "fortigates.update", category: "FortiGates", description: "FortiGate configuratie wijzigen" },
  { key: "fortigates.delete", category: "FortiGates", description: "FortiGate verwijderen" },
  { key: "fortigates.backup.run", category: "FortiGates", description: "Handmatige backup starten" },
  { key: "fortigates.logs.read", category: "FortiGates", description: "FortiGate logs bekijken" },
  { key: "fortigates.firmware.read", category: "FortiGates", description: "Firmware/status bekijken" },
  { key: "backups.read", category: "Backups", description: "Backupoverzicht bekijken" },
  { key: "backups.download", category: "Backups", description: "Backupbestand downloaden" },
  { key: "backups.diff.read", category: "Backups", description: "Diff bekijken" },
  { key: "alerts.read", category: "Alerts", description: "Alerts bekijken" },
  { key: "audit.read", category: "Audit", description: "Auditlogs binnen tenant bekijken" },
  { key: "integrations.mail.read", category: "Integraties", description: "Mailconfiguratie bekijken" },
  { key: "integrations.mail.update", category: "Integraties", description: "Mailconfiguratie wijzigen" },
  { key: "integrations.mail.test", category: "Integraties", description: "Testmail sturen" },
  { key: "integrations.itglue.read", category: "Integraties", description: "IT Glue instellingen bekijken" },
  { key: "integrations.itglue.update", category: "Integraties", description: "IT Glue instellingen wijzigen" },
  { key: "integrations.autotask.read", category: "Integraties", description: "Autotask instellingen bekijken" },
  { key: "integrations.autotask.update", category: "Integraties", description: "Autotask instellingen wijzigen" },
  { key: "integrations.sso.read", category: "Integraties", description: "SSO instellingen bekijken" },
  { key: "integrations.sso.update", category: "Integraties", description: "SSO instellingen wijzigen" }
] as const;

export type PermissionKey = (typeof permissions)[number]["key"];

const allPermissionKeys = permissions.map((permission) => permission.key);
const tenantPermissionKeys = allPermissionKeys.filter((key) => !key.startsWith("platform."));
const readPermissionKeys = tenantPermissionKeys.filter((key) => key.endsWith(".read"));
const operatorPermissionKeys = [
  "customers.read",
  "customers.create",
  "customers.update",
  "customers.delete",
  "fortigates.read",
  "fortigates.create",
  "fortigates.update",
  "fortigates.delete",
  "fortigates.backup.run",
  "fortigates.logs.read",
  "fortigates.firmware.read",
  "backups.read",
  "backups.download",
  "backups.diff.read",
  "alerts.read"
] satisfies PermissionKey[];

const defaultRoles = [
  {
    name: "Super Admin",
    description: "Platformbeheer met alle globale en tenantrechten.",
    permissionKeys: allPermissionKeys,
    globalOnly: true
  },
  {
    name: "Tenant Admin",
    description: "Volledig beheer binnen deze tenant.",
    permissionKeys: tenantPermissionKeys
  },
  {
    name: "Operator",
    description: "Dagelijks beheer van klanten, FortiGates en backups.",
    permissionKeys: operatorPermissionKeys
  },
  {
    name: "Backup Operator",
    description: "Backups bekijken, vergelijken, downloaden en starten.",
    permissionKeys: [
      "tenant.dashboard.read",
      "customers.read",
      "fortigates.read",
      "fortigates.backup.run",
      "fortigates.logs.read",
      "backups.read",
      "backups.download",
      "backups.diff.read",
      "alerts.read"
    ]
  },
  {
    name: "Auditor",
    description: "Alleen lezen inclusief audit en diff.",
    permissionKeys: [...readPermissionKeys, "backups.download", "backups.diff.read", "audit.read"]
  },
  {
    name: "Viewer",
    description: "Alleen lezen zonder downloadrechten.",
    permissionKeys: readPermissionKeys
  }
] as const;

export async function ensurePermissions() {
  for (const permission of permissions) {
    await prisma.accessPermission.upsert({
      where: { key: permission.key },
      update: { category: permission.category, description: permission.description },
      create: permission
    });
  }
}

export async function ensureTenantRbac(tenantId: string) {
  await ensurePermissions();
  const globalTenantId = await mainTenantId();
  const permissionRecords = await prisma.accessPermission.findMany();
  const permissionIds = new Map(permissionRecords.map((permission) => [permission.key, permission.id]));

  for (const roleTemplate of defaultRoles) {
    if ("globalOnly" in roleTemplate && roleTemplate.globalOnly && tenantId !== globalTenantId) continue;
    const role = await prisma.accessRole.upsert({
      where: { tenantId_name: { tenantId, name: roleTemplate.name } },
      update: { description: roleTemplate.description, system: true },
      create: { tenantId, name: roleTemplate.name, description: roleTemplate.description, system: true }
    });
    const desiredPermissionIds = [...new Set(roleTemplate.permissionKeys)]
      .map((key) => permissionIds.get(key))
      .filter((permissionId): permissionId is string => Boolean(permissionId));
    await prisma.accessRolePermission.deleteMany({
      where: {
        roleId: role.id,
        permissionId: { notIn: desiredPermissionIds }
      }
    });
    for (const permissionId of desiredPermissionIds) {
      await prisma.accessRolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId }
      });
    }
    if (roleTemplate.name === "Super Admin" && tenantId === globalTenantId) {
      const superAdmins = await prisma.user.findMany({
        where: { tenantId, role: UserRole.SUPER_ADMIN },
        select: { id: true }
      });
      for (const superAdmin of superAdmins) {
        await prisma.userAccessRole.upsert({
          where: { userId_roleId: { userId: superAdmin.id, roleId: role.id } },
          update: {},
          create: { userId: superAdmin.id, roleId: role.id }
        });
      }
    }
  }
}

export async function assignDefaultTenantRole(userId: string, tenantId: string, legacyRole: UserRole) {
  await ensureTenantRbac(tenantId);
  const roleName =
    legacyRole === UserRole.SUPER_ADMIN && tenantId === (await mainTenantId())
      ? "Super Admin"
      : legacyRole === UserRole.ADMIN
        ? "Tenant Admin"
        : "Viewer";
  const role = await prisma.accessRole.findUnique({ where: { tenantId_name: { tenantId, name: roleName } } });
  if (!role) return;
  await prisma.userAccessRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id }
  });
}

export async function userPermissionKeys(
  user: Pick<User, "id" | "role" | "tenantId"> & { activeTenantId?: string | null }
): Promise<Set<string>> {
  const globalTenantId = await mainTenantId();
  const contextTenantId = user.activeTenantId ?? user.tenantId;
  if (user.role === UserRole.SUPER_ADMIN) {
    return new Set(
      contextTenantId === globalTenantId
        ? allPermissionKeys
        : [...tenantPermissionKeys, "platform.tenants.switch"]
    );
  }
  if (!user.tenantId) return new Set<string>();
  const assignments = await prisma.userAccessRole.findMany({
    where: { userId: user.id, role: { tenantId: user.tenantId } },
    include: { role: { include: { permissions: { include: { permission: true } } } } }
  });
  const assignedKeys = assignments.length
    ? assignments.flatMap((assignment) => assignment.role.permissions.map((item) => item.permission.key))
    : user.role === UserRole.ADMIN
      ? tenantPermissionKeys
      : readPermissionKeys;
  if (user.tenantId !== globalTenantId || contextTenantId === globalTenantId) return new Set(assignedKeys);

  const contextualKeys = assignedKeys.filter((key) => !key.startsWith("platform."));
  if (assignedKeys.includes("platform.tenants.switch")) contextualKeys.push("platform.tenants.switch");
  return new Set(contextualKeys);
}

export async function hasPermission(user: Pick<User, "id" | "role" | "tenantId"> & { activeTenantId?: string | null }, permission: PermissionKey) {
  return (await userPermissionKeys(user)).has(permission);
}
