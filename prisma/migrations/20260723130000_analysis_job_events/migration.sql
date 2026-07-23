CREATE TABLE "SecurityAnalysisJobEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAnalysisJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityAnalysisJobEvent_tenantId_id_key"
    ON "SecurityAnalysisJobEvent"("tenantId", "id");
CREATE INDEX "SecurityAnalysisJobEvent_tenantId_jobId_createdAt_idx"
    ON "SecurityAnalysisJobEvent"("tenantId", "jobId", "createdAt");

ALTER TABLE "SecurityAnalysisJobEvent"
    ADD CONSTRAINT "SecurityAnalysisJobEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityAnalysisJobEvent"
    ADD CONSTRAINT "SecurityAnalysisJobEvent_tenantId_jobId_fkey"
    FOREIGN KEY ("tenantId", "jobId") REFERENCES "SecurityAnalysisJob"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecurityAnalysisJobEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysisJobEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SecurityAnalysisJobEvent_tenant_isolation"
    ON "SecurityAnalysisJobEvent"
    USING ("tenantId" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "SecurityAnalysisJobEvent"
    ADD CONSTRAINT "SecurityAnalysisJobEvent_stage_format"
    CHECK ("stage" ~ '^[A-Z][A-Z0-9_]{1,39}$');
ALTER TABLE "SecurityAnalysisJobEvent"
    ADD CONSTRAINT "SecurityAnalysisJobEvent_message_length"
    CHECK (char_length("message") BETWEEN 1 AND 240);
