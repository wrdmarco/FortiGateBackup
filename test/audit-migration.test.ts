import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260713120000_security_hardening/migration.sql"
);

test("auditmigratie bewaart actor- en tenantsnapshots na verwijdering", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "audit-migration-"));
  const databasePath = path.join(temporaryRoot, "legacy.db").replace(/\\/g, "/");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });

  try {
    await executeStatements(prisma, LEGACY_SCHEMA);
    await executeStatements(prisma, await readFile(migrationPath, "utf8"));

    const [migrated] = await prisma.$queryRawUnsafe<AuditSnapshot[]>(
      `SELECT "tenantId", "tenantName", "userId", "actorId", "actorName", "actorEmail"
       FROM "AuditLog" WHERE "id" = 'audit_legacy'`
    );
    assert.deepEqual(migrated, {
      tenantId: "tenant_global",
      tenantName: "Global",
      userId: "user_legacy",
      actorId: "user_legacy",
      actorName: "Historische Beheerder",
      actorEmail: "beheerder@example.test"
    });

    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = 'user_legacy'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = 'tenant_global'`);

    const [preserved] = await prisma.$queryRawUnsafe<AuditSnapshot[]>(
      `SELECT "tenantId", "tenantName", "userId", "actorId", "actorName", "actorEmail"
       FROM "AuditLog" WHERE "id" = 'audit_legacy'`
    );
    assert.deepEqual(preserved, {
      tenantId: "tenant_global",
      tenantName: "Global",
      userId: null,
      actorId: "user_legacy",
      actorName: "Historische Beheerder",
      actorEmail: "beheerder@example.test"
    });
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

type AuditSnapshot = {
  tenantId: string | null;
  tenantName: string | null;
  userId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

async function executeStatements(prisma: PrismaClient, sql: string) {
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

const LEGACY_SCHEMA = `
  PRAGMA foreign_keys=ON;
  CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL
  );
  CREATE TABLE "Customer" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT);
  CREATE TABLE "SystemSetting" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT);
  CREATE TABLE "AccessRole" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT);
  CREATE TABLE "FortiGate" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL
  );
  INSERT INTO "Tenant" ("id", "name", "slug", "active")
  VALUES ('tenant_global', 'Global', 'global', true);
  INSERT INTO "User" ("id", "name", "email", "role", "tenantId")
  VALUES ('user_legacy', 'Historische Beheerder', 'beheerder@example.test', 'SUPER_ADMIN', 'tenant_global');
  INSERT INTO "AuditLog" ("id", "tenantId", "userId", "action", "entity", "entityId")
  VALUES ('audit_legacy', 'tenant_global', 'user_legacy', 'settings.updated', 'SystemSetting', 'mail.provider');
`;
