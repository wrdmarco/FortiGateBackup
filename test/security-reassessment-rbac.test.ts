import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rbac = readFileSync("lib/rbac.ts", "utf8");
const actions = readFileSync("app/security/actions.ts", "utf8");
const history = readFileSync("app/customers/[id]/fortigates/[fortigateId]/backups/page.tsx", "utf8");
const worker = readFileSync("lib/security/analysis-worker.ts", "utf8");

test("opnieuw beoordelen heeft een afzonderlijke RBAC-permission", () => {
  assert.match(rbac, /security\.analyses\.reassess/);
  assert.match(rbac, /voltooide analyse van een gewijzigde backup opnieuw beoordelen/);
});

test("de standaard Operator krijgt herbeoordelen niet automatisch", () => {
  const operator = rbac.match(/const operatorPermissionKeys = \[([\s\S]*?)\]\s+satisfies/)?.[1] ?? "";
  assert.doesNotMatch(operator, /security\.analyses\.reassess/);
});

test("server action vereist permission, Global-herkomst, klantcontext en CHANGED backup", () => {
  assert.match(actions, /requirePermission\("security\.analyses\.reassess"\)/);
  assert.match(actions, /isGlobalTenantId\(user\.tenantId\)/);
  assert.match(actions, /isGlobalTenantId\(tenantId\)/);
  assert.match(actions, /status:"CHANGED"/);
  assert.match(actions, /isolationLevel:"Serializable"/);
});

test("herbeoordelingsknop staat alleen bij voltooide CHANGED backups met Global-herkomst", () => {
  assert.match(history, /canReassess=globalOrigin&&hasReassessPermission/);
  assert.match(history, /backup\.status==="CHANGED"/);
  assert.match(history, /analysis\?\.status==="COMPLETED"/);
  assert.match(history, /reassessSecurityAnalysisAction/);
});

test("worker behoudt oude analyse bij falen en schakelt rapport atomisch om", () => {
  assert.match(worker, /if \(!job\.reassessment\) \{\s*await tx\.securityAnalysis\.update/s);
  assert.match(worker, /securityAnalysisReport\.deleteMany/);
  assert.match(worker, /securityAnalysisReport\.create/);
  assert.match(worker, /removeReportWithRetry/);
  assert.match(worker, /bestaande rapport is behouden/);
});
