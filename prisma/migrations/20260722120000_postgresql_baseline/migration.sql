-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'ENTRA');

-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('GLOBAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('CHANGED', 'UNCHANGED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupJobTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'CRON');

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('SMTP', 'MICROSOFT_GRAPH');

-- CreateEnum
CREATE TYPE "FortiGateLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "SecurityAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SecurityAnalysisJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "FindingDispositionKind" AS ENUM ('ACCEPTED_RISK', 'ACKNOWLEDGED', 'FALSE_POSITIVE', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TenantKind" NOT NULL DEFAULT 'CUSTOMER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMPTZ(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPermission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "AccessRolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserAccessRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccessRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeTenantId" TEXT,
    "breakGlassSettingsOnly" BOOLEAN NOT NULL DEFAULT false,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "SetupToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "itGlueOrganizationId" TEXT,
    "autotaskCompanyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FortiGate" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hostname" TEXT,
    "serialNumber" TEXT,
    "model" TEXT,
    "firmwareVersion" TEXT,
    "firmwareBuild" TEXT,
    "uptime" TEXT,
    "externalIpAddresses" TEXT,
    "licenseInfo" TEXT,
    "itGlueConfigurationId" TEXT,
    "managementUrl" TEXT NOT NULL,
    "httpsPort" INTEGER NOT NULL DEFAULT 443,
    "apiTokenEncrypted" TEXT NOT NULL,
    "tlsVerify" BOOLEAN NOT NULL DEFAULT true,
    "tlsCertificateFingerprint" TEXT,
    "tlsCertificateSubject" TEXT,
    "tlsCertificateIssuer" TEXT,
    "tlsCertificateValidFrom" TIMESTAMPTZ(3),
    "tlsCertificateValidTo" TIMESTAMPTZ(3),
    "tlsCertificateAcceptedAt" TIMESTAMPTZ(3),
    "vdom" TEXT,
    "scheduleType" "ScheduleType" NOT NULL DEFAULT 'DAILY',
    "cronExpression" TEXT,
    "nextRunAt" TIMESTAMPTZ(3),
    "lastCheckedAt" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FortiGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "trigger" "BackupJobTrigger" NOT NULL,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "workerId" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),

    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "configArtifactId" TEXT,
    "filename" TEXT,
    "sha256" TEXT,
    "filesize" INTEGER NOT NULL DEFAULT 0,
    "status" "BackupStatus" NOT NULL,
    "error" TEXT,
    "itGlueAttachmentId" TEXT,
    "itGlueUploadedAt" TIMESTAMPTZ(3),
    "itGlueError" TEXT,
    "autotaskTicketId" TEXT,
    "autotaskTicketCreatedAt" TIMESTAMPTZ(3),
    "autotaskError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FortiGateLog" (
    "id" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "level" "FortiGateLogLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FortiGateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionHistory" (
    "id" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "firmwareVersion" TEXT NOT NULL,
    "firmwareBuild" TEXT,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditHead" (
    "scopeKey" TEXT NOT NULL,
    "tenantId" TEXT,
    "lastAuditId" TEXT,
    "lastHash" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditHead_pkey" PRIMARY KEY ("scopeKey")
);

-- CreateTable
CREATE TABLE "ConfigArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "filesize" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFoundryConfig" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" TEXT NOT NULL,
    "deployment" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "lastValidatedAt" TIMESTAMPTZ(3),
    "lastValidationStatus" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TenantFoundryConfig_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "SecurityAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "configArtifactId" TEXT NOT NULL,
    "configSha256" TEXT NOT NULL,
    "sourceBackupId" TEXT NOT NULL,
    "status" "SecurityAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "mediumCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "scoreComponents" TEXT,
    "parserVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "foundryDeployment" TEXT NOT NULL,
    "safeSummary" TEXT,
    "redactionStats" TEXT,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SecurityAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAnalysisJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fortigateId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "status" "SecurityAnalysisJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SecurityAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "penalty" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityFindingDisposition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "kind" "FindingDispositionKind" NOT NULL,
    "rationale" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecurityFindingDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAnalysisReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "filesize" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_kind_active_idx" ON "Tenant"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPermission_key_key" ON "AccessPermission"("key");

-- CreateIndex
CREATE INDEX "AccessRole_tenantId_idx" ON "AccessRole"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_tenantId_name_key" ON "AccessRole"("tenantId", "name");

-- CreateIndex
CREATE INDEX "UserAccessRole_roleId_idx" ON "UserAccessRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "SetupToken_tokenHash_key" ON "SetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SetupToken_expires_usedAt_idx" ON "SetupToken"("expires", "usedAt");

-- CreateIndex
CREATE INDEX "LoginThrottle_lockedUntil_idx" ON "LoginThrottle"("lockedUntil");

-- CreateIndex
CREATE INDEX "LoginThrottle_updatedAt_idx" ON "LoginThrottle"("updatedAt");

-- CreateIndex
CREATE INDEX "Customer_tenantId_active_idx" ON "Customer"("tenantId", "active");

-- CreateIndex
CREATE INDEX "FortiGate_customerId_active_idx" ON "FortiGate"("customerId", "active");

-- CreateIndex
CREATE INDEX "FortiGate_nextRunAt_idx" ON "FortiGate"("nextRunAt");

-- CreateIndex
CREATE INDEX "BackupJob_status_availableAt_createdAt_idx" ON "BackupJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "BackupJob_fortigateId_status_idx" ON "BackupJob"("fortigateId", "status");

-- CreateIndex
CREATE INDEX "BackupJob_tenantId_createdAt_idx" ON "BackupJob"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Backup_fortigateId_createdAt_idx" ON "Backup"("fortigateId", "createdAt");

-- CreateIndex
CREATE INDEX "Backup_tenantId_createdAt_idx" ON "Backup"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Backup_tenantId_configArtifactId_idx" ON "Backup"("tenantId", "configArtifactId");

-- CreateIndex
CREATE INDEX "FortiGateLog_fortigateId_createdAt_idx" ON "FortiGateLog"("fortigateId", "createdAt");

-- CreateIndex
CREATE INDEX "VersionHistory_fortigateId_detectedAt_idx" ON "VersionHistory"("fortigateId", "detectedAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_tenantId_key_key" ON "SystemSetting"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AuditHead_tenantId_key" ON "AuditHead"("tenantId");

-- CreateIndex
CREATE INDEX "ConfigArtifact_tenantId_fortigateId_createdAt_idx" ON "ConfigArtifact"("tenantId", "fortigateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigArtifact_tenantId_id_key" ON "ConfigArtifact"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigArtifact_tenantId_fortigateId_sha256_key" ON "ConfigArtifact"("tenantId", "fortigateId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysis_configArtifactId_key" ON "SecurityAnalysis"("configArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysis_sourceBackupId_key" ON "SecurityAnalysis"("sourceBackupId");

-- CreateIndex
CREATE INDEX "SecurityAnalysis_tenantId_fortigateId_completedAt_idx" ON "SecurityAnalysis"("tenantId", "fortigateId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysis_tenantId_id_key" ON "SecurityAnalysis"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysis_tenantId_configArtifactId_key" ON "SecurityAnalysis"("tenantId", "configArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysis_tenantId_fortigateId_configSha256_key" ON "SecurityAnalysis"("tenantId", "fortigateId", "configSha256");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisJob_analysisId_key" ON "SecurityAnalysisJob"("analysisId");

-- CreateIndex
CREATE INDEX "SecurityAnalysisJob_status_availableAt_idx" ON "SecurityAnalysisJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisJob_tenantId_id_key" ON "SecurityAnalysisJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisJob_tenantId_analysisId_key" ON "SecurityAnalysisJob"("tenantId", "analysisId");

-- CreateIndex
CREATE INDEX "SecurityFinding_tenantId_analysisId_severity_idx" ON "SecurityFinding"("tenantId", "analysisId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_tenantId_id_key" ON "SecurityFinding"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_analysisId_ruleId_evidence_key" ON "SecurityFinding"("analysisId", "ruleId", "evidence");

-- CreateIndex
CREATE INDEX "SecurityFindingDisposition_tenantId_kind_idx" ON "SecurityFindingDisposition"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFindingDisposition_tenantId_findingId_key" ON "SecurityFindingDisposition"("tenantId", "findingId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisReport_analysisId_key" ON "SecurityAnalysisReport"("analysisId");

-- CreateIndex
CREATE INDEX "SecurityAnalysisReport_tenantId_createdAt_idx" ON "SecurityAnalysisReport"("tenantId", "createdAt");

-- PostgreSQL-only invariants which Prisma cannot express.
CREATE UNIQUE INDEX "Tenant_single_global" ON "Tenant" ((kind)) WHERE kind = 'GLOBAL';
CREATE UNIQUE INDEX "SystemSetting_global_key" ON "SystemSetting" ("key") WHERE "tenantId" IS NULL;
CREATE UNIQUE INDEX "SystemSetting_tenant_key" ON "SystemSetting" ("tenantId", "key") WHERE "tenantId" IS NOT NULL;
CREATE UNIQUE INDEX "BackupJob_one_active_per_fortigate" ON "BackupJob" ("fortigateId") WHERE status IN ('PENDING','RUNNING');
CREATE UNIQUE INDEX "SecurityAnalysisJob_one_active_per_analysis" ON "SecurityAnalysisJob" ("analysisId") WHERE status IN ('PENDING','RUNNING');
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_score_range" CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE "ConfigArtifact" ADD CONSTRAINT "ConfigArtifact_sha256_format" CHECK (sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_sha256_format" CHECK ("configSha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SecurityAnalysisReport" ADD CONSTRAINT "SecurityAnalysisReport_sha256_format" CHECK (sha256 ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION fortibackup_assert_customer_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_tenant text;
BEGIN
  SELECT c."tenantId" INTO actual_tenant FROM "FortiGate" f JOIN "Customer" c ON c.id=f."customerId" WHERE f.id=NEW."fortigateId";
  IF actual_tenant IS NULL OR actual_tenant <> NEW."tenantId" THEN RAISE EXCEPTION 'cross-tenant FortiGate reference'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConfigArtifact_tenant_guard" BEFORE INSERT OR UPDATE ON "ConfigArtifact" FOR EACH ROW EXECUTE FUNCTION fortibackup_assert_customer_tenant();
CREATE TRIGGER "SecurityAnalysis_tenant_guard" BEFORE INSERT OR UPDATE ON "SecurityAnalysis" FOR EACH ROW EXECUTE FUNCTION fortibackup_assert_customer_tenant();
CREATE TRIGGER "SecurityAnalysisJob_tenant_guard" BEFORE INSERT OR UPDATE ON "SecurityAnalysisJob" FOR EACH ROW EXECUTE FUNCTION fortibackup_assert_customer_tenant();
CREATE TRIGGER "Backup_tenant_guard" BEFORE INSERT OR UPDATE ON "Backup" FOR EACH ROW EXECUTE FUNCTION fortibackup_assert_customer_tenant();

CREATE OR REPLACE FUNCTION fortibackup_customer_foundry_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE id=NEW."tenantId" AND kind='CUSTOMER') THEN RAISE EXCEPTION 'Foundry configuration is restricted to CUSTOMER tenants'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TenantFoundryConfig_customer_only" BEFORE INSERT OR UPDATE ON "TenantFoundryConfig" FOR EACH ROW EXECUTE FUNCTION fortibackup_customer_foundry_only();

-- Tenant context must be set with SET LOCAL app.tenant_id inside every transaction.
ALTER TABLE "ConfigArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConfigArtifact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TenantFoundryConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantFoundryConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysis" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysisJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysisJob" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityFinding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityFindingDisposition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityFindingDisposition" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysisReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityAnalysisReport" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ConfigArtifact_tenant_isolation" ON "ConfigArtifact" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "TenantFoundryConfig_tenant_isolation" ON "TenantFoundryConfig" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "SecurityAnalysis_tenant_isolation" ON "SecurityAnalysis" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "SecurityAnalysisJob_tenant_isolation" ON "SecurityAnalysisJob" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "SecurityAnalysisJob_worker_claim" ON "SecurityAnalysisJob" TO PUBLIC USING (current_setting('app.worker', true) = '1') WITH CHECK (current_setting('app.worker', true) = '1');
CREATE POLICY "SecurityFinding_tenant_isolation" ON "SecurityFinding" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "SecurityFindingDisposition_tenant_isolation" ON "SecurityFindingDisposition" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "SecurityAnalysisReport_tenant_isolation" ON "SecurityAnalysisReport" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "ConfigArtifact_migrator" ON "ConfigArtifact" USING (current_user = 'fortibackup_migrator') WITH CHECK (current_user = 'fortibackup_migrator');

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisReport_tenantId_id_key" ON "SecurityAnalysisReport"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAnalysisReport_tenantId_analysisId_key" ON "SecurityAnalysisReport"("tenantId", "analysisId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRolePermission" ADD CONSTRAINT "AccessRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRolePermission" ADD CONSTRAINT "AccessRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "AccessPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessRole" ADD CONSTRAINT "UserAccessRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessRole" ADD CONSTRAINT "UserAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortiGate" ADD CONSTRAINT "FortiGate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupJob" ADD CONSTRAINT "BackupJob_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_tenantId_configArtifactId_fkey" FOREIGN KEY ("tenantId", "configArtifactId") REFERENCES "ConfigArtifact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortiGateLog" ADD CONSTRAINT "FortiGateLog_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionHistory" ADD CONSTRAINT "VersionHistory_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditHead" ADD CONSTRAINT "AuditHead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigArtifact" ADD CONSTRAINT "ConfigArtifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigArtifact" ADD CONSTRAINT "ConfigArtifact_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFoundryConfig" ADD CONSTRAINT "TenantFoundryConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_tenantId_configArtifactId_fkey" FOREIGN KEY ("tenantId", "configArtifactId") REFERENCES "ConfigArtifact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysis" ADD CONSTRAINT "SecurityAnalysis_sourceBackupId_fkey" FOREIGN KEY ("sourceBackupId") REFERENCES "Backup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysisJob" ADD CONSTRAINT "SecurityAnalysisJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysisJob" ADD CONSTRAINT "SecurityAnalysisJob_fortigateId_fkey" FOREIGN KEY ("fortigateId") REFERENCES "FortiGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysisJob" ADD CONSTRAINT "SecurityAnalysisJob_tenantId_analysisId_fkey" FOREIGN KEY ("tenantId", "analysisId") REFERENCES "SecurityAnalysis"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_tenantId_analysisId_fkey" FOREIGN KEY ("tenantId", "analysisId") REFERENCES "SecurityAnalysis"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFindingDisposition" ADD CONSTRAINT "SecurityFindingDisposition_tenantId_findingId_fkey" FOREIGN KEY ("tenantId", "findingId") REFERENCES "SecurityFinding"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysisReport" ADD CONSTRAINT "SecurityAnalysisReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAnalysisReport" ADD CONSTRAINT "SecurityAnalysisReport_tenantId_analysisId_fkey" FOREIGN KEY ("tenantId", "analysisId") REFERENCES "SecurityAnalysis"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
