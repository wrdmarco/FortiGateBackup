import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prisma } from "./db";
import { createTenantArchive, restoreTenantArchive } from "./tenant-archive";

const integrationEnabled = process.env.TENANT_ARCHIVE_INTEGRATION === "1";

test("ontbrekende CUSTOMER-tenant wordt inclusief identiteit, RBAC en audit atomair hersteld", { skip: !integrationEnabled }, async () => {
  const originalCwd = process.cwd();
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tenant-archive-integration-"));
  process.chdir(dataDirectory);

  try {
    await prisma.tenant.create({ data: { id: "global_tenant", name: "Global", slug: "global", kind: "GLOBAL" } });
    await prisma.user.create({
      data: {
        id: "global_admin",
        tenantId: "global_tenant",
        name: "Global Admin",
        email: "global@example.test",
        passwordHash: "$2b$12$global-password-hash",
        role: "SUPER_ADMIN",
        provider: "LOCAL"
      }
    });
    await prisma.accessPermission.create({
      data: { id: "permission_users_update", key: "tenant.users.update", category: "Tenant", description: "Gebruikers beheren" }
    });
    await prisma.tenant.create({
      data: { id: "customer_tenant", name: "Acme", slug: "acme", kind: "CUSTOMER", active: true }
    });
    await prisma.accessRole.create({
      data: {
        id: "customer_admin_role",
        tenantId: "customer_tenant",
        name: "Tenant Admin",
        description: "Beheerder",
        system: true,
        permissions: {
          create: { permission: { connect: { id: "permission_users_update" } } }
        }
      }
    });
    await prisma.user.create({
      data: {
        id: "customer_admin",
        tenantId: "customer_tenant",
        name: "Acme Admin",
        email: "admin@acme.test",
        passwordHash: "$2b$12$customer-password-hash",
        mustChangePassword: true,
        role: "ADMIN",
        provider: "LOCAL",
        accessRoles: { create: { roleId: "customer_admin_role" } },
        sessions: {
          create: {
            id: "customer_session",
            sessionToken: "integration-session-token",
            activeTenantId: "customer_tenant",
            expires: new Date("2030-01-01T00:00:00.000Z")
          }
        },
        accounts: {
          create: {
            id: "customer_account",
            type: "oauth",
            provider: "microsoft-entra-id",
            providerAccountId: "customer-provider-account",
            access_token: "must-not-be-archived"
          }
        }
      }
    });
    await prisma.auditLog.create({
      data: {
        id: "customer_audit",
        tenantId: "customer_tenant",
        tenantName: "Acme",
        userId: "customer_admin",
        actorName: "Acme Admin",
        actorEmail: "admin@acme.test",
        action: "customer.created",
        outcome: "success",
        entity: "Customer",
        entityId: "customer_1",
        requestId: "integration-request",
        createdAt: new Date("2026-07-14T10:00:00.000Z")
      }
    });

    const archive = await createTenantArchive("customer_tenant");
    await prisma.tenant.delete({ where: { id: "customer_tenant" } });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "customer_admin" } })).tenantId, null);
    assert.equal(await prisma.session.count({ where: { userId: "customer_admin" } }), 1);
    assert.equal(await prisma.account.count({ where: { userId: "customer_admin" } }), 1);

    await restoreTenantArchive({
      tenantId: "customer_tenant",
      archive: archive.buffer,
      userId: "global_admin",
      createTenantIfMissing: true
    });

    const restoredTenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: "customer_tenant" },
      include: {
        users: { include: { accessRoles: { include: { role: { include: { permissions: true } } } } } },
        accessRoles: true
      }
    });
    assert.equal(restoredTenant.kind, "CUSTOMER");
    assert.equal(restoredTenant.slug, "acme");
    assert.equal(restoredTenant.users.length, 1);
    assert.equal(restoredTenant.users[0].role, "ADMIN");
    assert.equal(restoredTenant.users[0].mustChangePassword, true);
    assert.equal(restoredTenant.users[0].accessRoles[0].role.id, "customer_admin_role");
    assert.equal(restoredTenant.users[0].accessRoles[0].role.permissions.length, 1);
    assert.equal(await prisma.session.count({ where: { userId: "customer_admin" } }), 0);
    assert.equal(await prisma.account.count({ where: { userId: "customer_admin" } }), 0);
    assert.ok(await prisma.auditLog.findUnique({ where: { id: "customer_audit" } }));
    assert.equal(await prisma.auditLog.count({ where: { tenantId: "customer_tenant" } }), 2);
  } finally {
    process.chdir(originalCwd);
    await prisma.$disconnect();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
