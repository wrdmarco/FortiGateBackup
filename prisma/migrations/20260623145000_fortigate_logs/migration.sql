CREATE TABLE "FortiGateLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fortigateId" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'INFO',
  "event" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FortiGateLog_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FortiGateLog_fortigateId_createdAt_idx" ON "FortiGateLog"("fortigateId", "createdAt");
