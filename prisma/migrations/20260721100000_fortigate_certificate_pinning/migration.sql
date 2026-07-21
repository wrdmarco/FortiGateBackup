ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateFingerprint" TEXT;
ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateSubject" TEXT;
ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateIssuer" TEXT;
ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateValidFrom" DATETIME;
ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateValidTo" DATETIME;
ALTER TABLE "FortiGate" ADD COLUMN "tlsCertificateAcceptedAt" DATETIME;

UPDATE "FortiGate" SET "tlsVerify" = 1;
