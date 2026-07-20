import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { TenantKind, UserRole } from "@prisma/client";
import { auditLog, verifyAuditTrail } from "@/lib/audit";
import { prisma } from "@/lib/db";

test("audit-HMAC vormt een keten, redigeert secrets en detecteert manipulatie", async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const tenantId = `audit_tenant_${suffix}`;
  const userId = `audit_user_${suffix}`;
  try {
    await prisma.tenant.create({
      data: { id: tenantId, name: "Audit klant", slug: `audit-${suffix}`, kind: TenantKind.CUSTOMER }
    });
    await prisma.user.create({
      data: { id: userId, tenantId, name: "Audit Actor", email: `audit-${suffix}@example.test`, role: UserRole.ADMIN }
    });

    await auditLog({
      action: "customer.created",
      tenantId,
      userId,
      entity: "Customer",
      entityId: "customer-a",
      requestId: `request-a-${suffix}`,
      ipAddress: "192.0.2.10",
      metadata: { name: "Acme", apiToken: "must-not-leak", nested: { password: "also-secret", safe: "kept" } }
    });
    await delay(5);
    await auditLog({
      action: "customer.updated",
      tenantId,
      userId,
      entity: "Customer",
      entityId: "customer-a",
      requestId: `request-b-${suffix}`,
      ipAddress: "192.0.2.10",
      metadata: { field: "name" }
    });

    const entries = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    assert.equal(entries.length, 2);
    assert.match(entries[0].integrityHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(entries[0].previousHash, null);
    assert.equal(entries[1].previousHash, entries[0].integrityHash);
    assert.deepEqual(await verifyAuditTrail(tenantId), { valid: true, checked: 2, invalidEntryId: null });

    const metadata = JSON.parse(entries[0].metadata ?? "{}") as Record<string, unknown>;
    assert.equal(metadata.apiToken, "[REDACTED]");
    assert.deepEqual(metadata.nested, { password: "[REDACTED]", safe: "kept" });
    assert.equal(entries[0].actorName, "Audit Actor");
    assert.equal(entries[0].actorEmail, `audit-${suffix}@example.test`);
    assert.equal(entries[0].tenantName, "Audit klant");

    await prisma.auditLog.update({ where: { id: entries[0].id }, data: { metadata: "{\"tampered\":true}" } });
    assert.deepEqual(await verifyAuditTrail(tenantId), {
      valid: false,
      checked: 2,
      invalidEntryId: entries[0].id
    });
    await prisma.auditLog.update({ where: { id: entries[0].id }, data: { metadata: entries[0].metadata } });
    assert.deepEqual(await verifyAuditTrail(tenantId), { valid: true, checked: 2, invalidEntryId: null });

    await prisma.auditLog.update({ where: { id: entries[1].id }, data: { previousHash: "0".repeat(64) } });
    assert.deepEqual(await verifyAuditTrail(tenantId), {
      valid: false,
      checked: 2,
      invalidEntryId: entries[1].id
    });
    await prisma.auditLog.update({ where: { id: entries[1].id }, data: { previousHash: entries[1].previousHash } });

    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    const persisted = await prisma.auditLog.findUniqueOrThrow({ where: { id: entries[0].id } });
    assert.equal(persisted.userId, null);
    assert.equal(persisted.actorId, userId);
    assert.equal(persisted.tenantId, tenantId);
    assert.equal(persisted.tenantName, "Audit klant");
    assert.equal(persisted.actorName, "Audit Actor");
    assert.equal(persisted.actorEmail, `audit-${suffix}@example.test`);
    assert.deepEqual(await verifyAuditTrail(tenantId), { valid: true, checked: 2, invalidEntryId: null });
  } finally {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  }
});
