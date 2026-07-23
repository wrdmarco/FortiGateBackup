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
