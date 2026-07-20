import assert from "node:assert/strict";
import test from "node:test";
import { TenantKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assignDefaultTenantRole,
  ensureTenantRbac,
  permissions,
  userPermissionKeys
} from "@/lib/rbac";

test("permissioncatalogus en standaardrollen bewaken tenant- en platformgrenzen", async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const globalId = `rbac_global_${suffix}`;
  const tenantId = `rbac_customer_${suffix}`;
  const globalAdminId = `rbac_super_${suffix}`;
  const globalCustomUserId = `rbac_global_custom_${suffix}`;
  const tenantAdminId = `rbac_admin_${suffix}`;
  const customUserId = `rbac_custom_${suffix}`;
  const previousGlobalIds = (
    await prisma.tenant.findMany({ where: { kind: TenantKind.GLOBAL }, select: { id: true } })
  ).map(({ id }) => id);

  try {
    const catalogKeys = permissions.map(({ key }) => key);
    assert.equal(new Set(catalogKeys).size, catalogKeys.length, "permission keys moeten uniek zijn");
    assert.ok(permissions.every(({ key, category, description }) => key.includes(".") && category.trim() && description.trim()));
    assert.ok(catalogKeys.includes("platform.super_admin.assign"));
    assert.ok(catalogKeys.includes("platform.tenants.restore"));

    await prisma.tenant.updateMany({ where: { kind: TenantKind.GLOBAL }, data: { kind: TenantKind.CUSTOMER } });
    await prisma.tenant.createMany({
      data: [
        { id: globalId, name: "Global RBAC", slug: `global-rbac-${suffix}`, kind: TenantKind.GLOBAL },
        { id: tenantId, name: "Customer RBAC", slug: `customer-rbac-${suffix}`, kind: TenantKind.CUSTOMER }
      ]
    });
    await prisma.user.createMany({
      data: [
        {
          id: globalAdminId,
          tenantId: globalId,
          email: `super-${suffix}@example.test`,
          role: UserRole.SUPER_ADMIN
        },
        {
          id: globalCustomUserId,
          tenantId: globalId,
          email: `global-custom-${suffix}@example.test`,
          role: UserRole.VIEWER
        },
        {
          id: tenantAdminId,
          tenantId,
          email: `admin-${suffix}@example.test`,
          role: UserRole.ADMIN
        },
        {
          id: customUserId,
          tenantId,
          email: `custom-${suffix}@example.test`,
          role: UserRole.VIEWER
        }
      ]
    });

    await ensureTenantRbac(globalId);
    await ensureTenantRbac(tenantId);
    await ensureTenantRbac(tenantId);

    const [globalRoles, tenantRoles] = await Promise.all([
      prisma.accessRole.findMany({
        where: { tenantId: globalId },
        include: { permissions: { include: { permission: true } }, users: true }
      }),
      prisma.accessRole.findMany({
        where: { tenantId },
        include: { permissions: { include: { permission: true } } }
      })
    ]);
    assert.deepEqual(
      new Set(globalRoles.map(({ name }) => name)),
      new Set(["Super Admin", "Tenant Admin", "Operator", "Backup Operator", "Auditor", "Viewer"])
    );
    assert.equal(tenantRoles.some(({ name }) => name === "Super Admin"), false);
    assert.equal(tenantRoles.length, 5);
    assert.ok(
      tenantRoles.every((role) => role.permissions.every(({ permission }) => !permission.key.startsWith("platform.")))
    );

    const byName = new Map(tenantRoles.map((role) => [role.name, new Set(role.permissions.map(({ permission }) => permission.key))]));
    const tenantKeys = catalogKeys.filter((key) => !key.startsWith("platform."));
    assert.deepEqual(byName.get("Tenant Admin"), new Set(tenantKeys));
    assert.ok(byName.get("Operator")?.has("fortigates.backup.run"));
    assert.ok(byName.get("Operator")?.has("customers.delete"));
    assert.equal([...byName.get("Operator")!].some((key) => key.startsWith("integrations.")), false);
    assert.equal([...byName.get("Operator")!].some((key) => key.startsWith("tenant.")), false);
    assert.equal(byName.get("Viewer")?.has("backups.download"), false);
    assert.ok([...byName.get("Viewer")!].every((key) => key.endsWith(".read")));

    const globalSuperRole = globalRoles.find(({ name }) => name === "Super Admin");
    assert.ok(globalSuperRole);
    assert.deepEqual(new Set(globalSuperRole.permissions.map(({ permission }) => permission.key)), new Set(catalogKeys));
    assert.ok(globalSuperRole.users.some(({ userId }) => userId === globalAdminId));

    await assignDefaultTenantRole(tenantAdminId, tenantId, UserRole.ADMIN);
    assert.deepEqual(await userPermissionKeys({ id: tenantAdminId, tenantId, role: UserRole.ADMIN }), new Set(tenantKeys));
    assert.deepEqual(
      await userPermissionKeys({ id: globalAdminId, tenantId: globalId, activeTenantId: globalId, role: UserRole.SUPER_ADMIN }),
      new Set(catalogKeys)
    );
    assert.deepEqual(
      await userPermissionKeys({ id: globalAdminId, tenantId: globalId, activeTenantId: tenantId, role: UserRole.SUPER_ADMIN }),
      new Set([...tenantKeys, "platform.tenants.switch"])
    );

    const switchPermission = await prisma.accessPermission.findUniqueOrThrow({ where: { key: "platform.tenants.switch" } });
    const globalCustomerReadPermission = await prisma.accessPermission.findUniqueOrThrow({ where: { key: "customers.read" } });
    const globalCustomRole = await prisma.accessRole.create({
      data: {
        tenantId: globalId,
        name: `Global custom ${suffix}`,
        permissions: {
          create: [
            { permissionId: switchPermission.id },
            { permissionId: globalCustomerReadPermission.id }
          ]
        },
        users: { create: { userId: globalCustomUserId } }
      }
    });
    assert.deepEqual(
      await userPermissionKeys({ id: globalCustomUserId, tenantId: globalId, activeTenantId: tenantId, role: UserRole.VIEWER }),
      new Set(["customers.read", "platform.tenants.switch"])
    );
    assert.equal(await prisma.userAccessRole.count({ where: { roleId: globalCustomRole.id } }), 1);

    const customerReadPermission = await prisma.accessPermission.findUniqueOrThrow({ where: { key: "customers.read" } });
    const customRole = await prisma.accessRole.create({
      data: {
        tenantId,
        name: `Custom ${suffix}`,
        permissions: { create: { permissionId: customerReadPermission.id } },
        users: { create: { userId: customUserId } }
      }
    });
    assert.deepEqual(
      await userPermissionKeys({ id: customUserId, tenantId, role: UserRole.VIEWER }),
      new Set(["customers.read"])
    );
    assert.equal(await prisma.userAccessRole.count({ where: { roleId: customRole.id } }), 1);
  } finally {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [globalId, tenantId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [globalAdminId, globalCustomUserId, tenantAdminId, customUserId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [globalId, tenantId] } } });
    if (previousGlobalIds.length) {
      await prisma.tenant.updateMany({ where: { id: { in: previousGlobalIds } }, data: { kind: TenantKind.GLOBAL } });
    }
    await prisma.$disconnect();
  }
});
