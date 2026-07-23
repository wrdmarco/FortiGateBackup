ALTER TABLE "SecurityAnalysisJob"
  ADD COLUMN "reassessment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "targetRulesetVersion" TEXT;
