ALTER TABLE "Customer" ADD COLUMN "autotaskCompanyId" TEXT;
ALTER TABLE "Backup" ADD COLUMN "autotaskTicketId" TEXT;
ALTER TABLE "Backup" ADD COLUMN "autotaskTicketCreatedAt" DATETIME;
ALTER TABLE "Backup" ADD COLUMN "autotaskError" TEXT;
