PRAGMA foreign_keys=OFF;

CREATE TABLE "new_FortiGate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "hostname" TEXT,
    "serialNumber" TEXT,
    "model" TEXT,
    "firmwareVersion" TEXT,
    "firmwareBuild" TEXT,
    "uptime" TEXT,
    "managementUrl" TEXT NOT NULL,
    "httpsPort" INTEGER NOT NULL DEFAULT 443,
    "apiTokenEncrypted" TEXT NOT NULL,
    "tlsVerify" BOOLEAN NOT NULL DEFAULT false,
    "vdom" TEXT,
    "scheduleType" TEXT NOT NULL DEFAULT 'DAILY',
    "cronExpression" TEXT,
    "nextRunAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FortiGate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_FortiGate" (
    "id",
    "customerId",
    "hostname",
    "serialNumber",
    "model",
    "firmwareVersion",
    "firmwareBuild",
    "uptime",
    "managementUrl",
    "httpsPort",
    "apiTokenEncrypted",
    "tlsVerify",
    "vdom",
    "scheduleType",
    "cronExpression",
    "nextRunAt",
    "lastCheckedAt",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "customerId",
    "hostname",
    "serialNumber",
    "model",
    "firmwareVersion",
    "firmwareBuild",
    "uptime",
    "managementUrl",
    "httpsPort",
    "apiTokenEncrypted",
    "tlsVerify",
    "vdom",
    "scheduleType",
    "cronExpression",
    "nextRunAt",
    "lastCheckedAt",
    "active",
    "createdAt",
    "updatedAt"
FROM "FortiGate";

DROP TABLE "FortiGate";
ALTER TABLE "new_FortiGate" RENAME TO "FortiGate";

CREATE INDEX "FortiGate_customerId_active_idx" ON "FortiGate"("customerId", "active");
CREATE INDEX "FortiGate_nextRunAt_idx" ON "FortiGate"("nextRunAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
