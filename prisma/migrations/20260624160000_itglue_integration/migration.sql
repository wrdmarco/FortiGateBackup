ALTER TABLE "Customer" ADD COLUMN "itGlueOrganizationId" TEXT;
ALTER TABLE "FortiGate" ADD COLUMN "itGlueConfigurationId" TEXT;
ALTER TABLE "Backup" ADD COLUMN "itGlueAttachmentId" TEXT;
ALTER TABLE "Backup" ADD COLUMN "itGlueUploadedAt" DATETIME;
ALTER TABLE "Backup" ADD COLUMN "itGlueError" TEXT;