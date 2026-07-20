PRAGMA foreign_keys=OFF;

ALTER TABLE "Tenant" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CUSTOMER';

UPDATE "Tenant"
SET "kind" = 'GLOBAL'
WHERE "id" = COALESCE(
  (
    SELECT "tenantId"
    FROM "User"
    WHERE "role" = 'SUPER_ADMIN' AND "tenantId" IS NOT NULL
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 1
  ),
  (
    SELECT "id"
    FROM "Tenant"
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 1
  )
);

UPDATE "Tenant"
SET
  "name" = 'Legacy Global',
  "slug" = 'legacy-global-' || substr("id", 1, 8),
  "active" = 0
WHERE "kind" = 'CUSTOMER'
  AND (lower(trim("name")) IN ('global', 'globaal', 'main tenant') OR lower(trim("slug")) IN ('global', 'globaal', 'main-tenant'));

UPDATE "Tenant" SET "name" = 'Global', "slug" = 'global', "active" = 1 WHERE "kind" = 'GLOBAL';

DELETE FROM "Tenant"
WHERE "name" = 'Legacy Global'
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."tenantId" = "Tenant"."id")
  AND NOT EXISTS (SELECT 1 FROM "Customer" WHERE "Customer"."tenantId" = "Tenant"."id")
  AND NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "SystemSetting"."tenantId" = "Tenant"."id")
  AND NOT EXISTS (SELECT 1 FROM "AccessRole" WHERE "AccessRole"."tenantId" = "Tenant"."id");

CREATE UNIQUE INDEX "Tenant_single_global_key" ON "Tenant"("kind") WHERE "kind" = 'GLOBAL';
CREATE INDEX "Tenant_kind_active_idx" ON "Tenant"("kind", "active");

CREATE TABLE "SetupToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "expires" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SetupToken_tokenHash_key" ON "SetupToken"("tokenHash");
CREATE INDEX "SetupToken_expires_usedAt_idx" ON "SetupToken"("expires", "usedAt");

CREATE TABLE "LoginThrottle" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" DATETIME,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "LoginThrottle_lockedUntil_idx" ON "LoginThrottle"("lockedUntil");
CREATE INDEX "LoginThrottle_updatedAt_idx" ON "LoginThrottle"("updatedAt");

CREATE TABLE "new_AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT,
  "tenantName" TEXT,
  "userId" TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL DEFAULT 'success',
  "entity" TEXT,
  "entityId" TEXT,
  "metadata" TEXT,
  "ipAddress" TEXT,
  "requestId" TEXT,
  "previousHash" TEXT,
  "integrityHash" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_AuditLog" (
  "id", "tenantId", "tenantName", "userId", "actorId", "actorName", "actorEmail",
  "action", "entity", "entityId", "metadata", "ipAddress", "createdAt"
)
SELECT
  audit."id",
  audit."tenantId",
  tenant."name",
  audit."userId",
  audit."userId",
  actor."name",
  actor."email",
  audit."action",
  audit."entity",
  audit."entityId",
  audit."metadata",
  audit."ipAddress",
  audit."createdAt"
FROM "AuditLog" AS audit
LEFT JOIN "Tenant" AS tenant ON tenant."id" = audit."tenantId"
LEFT JOIN "User" AS actor ON actor."id" = audit."userId";

DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

CREATE TABLE "BackupJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fortigateId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BackupJob_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BackupJob_status_availableAt_createdAt_idx" ON "BackupJob"("status", "availableAt", "createdAt");
CREATE INDEX "BackupJob_fortigateId_status_idx" ON "BackupJob"("fortigateId", "status");
CREATE INDEX "BackupJob_tenantId_createdAt_idx" ON "BackupJob"("tenantId", "createdAt");
CREATE UNIQUE INDEX "BackupJob_one_active_per_device_key" ON "BackupJob"("fortigateId") WHERE "status" IN ('PENDING', 'RUNNING');

PRAGMA foreign_keys=ON;
