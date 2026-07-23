import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("analysequeue bewaart uitsluitend vaste veilige voortgangsfases", async () => {
  const worker = await readFile(path.join(process.cwd(), "lib/security/analysis-worker.ts"), "utf8");
  for (const stage of ["ARTIFACT_VERIFY", "LOCAL_PARSE", "LOCAL_RULES", "FOUNDRY", "PDF_REPORT", "PERSIST", "COMPLETED"]) {
    assert.match(worker, new RegExp(`"${stage}"`));
  }
  assert.doesNotMatch(worker, /securityAnalysisJobEvent\.create\([^)]*(?:content|payload|apiKey|requestBody|responseBody)/s);
});

test("analyseworker gebruikt twee begrensde lanes naast de zelfstandige backupworker", async () => {
  const worker = await readFile(path.join(process.cwd(), "lib/security/analysis-worker.ts"), "utf8");
  const runner = await readFile(path.join(process.cwd(), "scripts/worker.ts"), "utf8");
  assert.match(worker, /ANALYSIS_CONCURRENCY = 2/);
  assert.match(worker, /if \(processing\) return processing/);
  assert.match(worker, /Promise\.all\(Array\.from\(\{ length: ANALYSIS_CONCURRENCY \}/);
  assert.match(runner, /processBackupJobs/);
  assert.match(runner, /processSecurityAnalysisJobs/);
  assert.match(runner, /const jobTimer = setInterval/);
  assert.match(runner, /const analysisTimer = setInterval/);
});

test("backupworker herstelt lease-loze jobs en stopt na alle ingestelde retries", async () => {
  const worker = await readFile(path.join(process.cwd(), "lib/backup-jobs.ts"), "utf8");
  assert.match(worker, /recoverStaleBackupJobs/);
  assert.match(worker, /\{ leaseExpiresAt: null \}/);
  assert.match(worker, /job\.attempts > retryCount/);
  assert.match(worker, /alle ingestelde pogingen waren verbruikt/);
});

test("analysejoblogs hebben samengestelde tenant-FK en geforceerde RLS", async () => {
  const migration = await readFile(
    path.join(process.cwd(), "prisma/migrations/20260723130000_analysis_job_events/migration.sql"),
    "utf8"
  );
  assert.match(migration, /FOREIGN KEY \("tenantId", "jobId"\)/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /SecurityAnalysisJobEvent_tenant_isolation/);
  assert.match(migration, /current_setting\('app\.tenant_id', true\)/);
});

test("queue leest analysejobs binnen een tenanttransactie", async () => {
  const queue = await readFile(path.join(process.cwd(), "app/queue/page.tsx"), "utf8");
  assert.match(queue, /tenantTransaction\(tenantId/);
  assert.match(queue, /<Modal/);
  assert.match(queue, /Live log/);
  assert.match(queue, /analysisErrorLabel/);
  assert.doesNotMatch(queue, /<details/);
});

test("auditdetails gebruiken een brede modal met volledige veilige context", async () => {
  const audit = await readFile(path.join(process.cwd(), "app/audit/page.tsx"), "utf8");
  assert.match(audit, /title="Auditdetails"/);
  assert.match(audit, /size="wide"/);
  assert.match(audit, /Integriteitshash/);
  assert.match(audit, /Volledige geredigeerde metadata/);
  assert.doesNotMatch(audit, /<details/);
});
