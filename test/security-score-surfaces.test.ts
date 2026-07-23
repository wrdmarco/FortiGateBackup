import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("klantpagina toont één actuele scorestatus per FortiGate", async () => {
  const page = await readFile(path.join(process.cwd(), "app/customers/[id]/page.tsx"), "utf8");
  assert.match(page, /customerSecurityOverview/);
  assert.match(page, /Gemiddelde score/);
  assert.match(page, /Analysedekking/);
  assert.match(page, /Beveiligingsscore/);
  assert.match(page, /Wacht op analyse/);
});

test("FortiGate-detail toont actuele score en lokale historie", async () => {
  const page = await readFile(path.join(process.cwd(), "app/customers/[id]/fortigates/[fortigateId]/page.tsx"), "utf8");
  assert.match(page, /fortigateSecuritySnapshot/);
  assert.match(page, /SecurityScoreChart/);
  assert.match(page, /Open analyse/);
  assert.match(page, /Volledige scorehistorie/);
});

test("scorequeries gebruiken uitsluitend CHANGED en voltooide historische analyses", async () => {
  const queries = await readFile(path.join(process.cwd(), "lib/security/queries.ts"), "utf8");
  assert.match(queries, /status: BackupStatus\.CHANGED/);
  assert.match(queries, /status: SecurityAnalysisStatus\.COMPLETED/);
  assert.match(queries, /\/ completed\.length/);
  assert.doesNotMatch(queries, /average:.*\/ devices\.length/);
});

test("scores worden overal als percentage gepresenteerd", async () => {
  const sources = await Promise.all([
    readFile("app/security/page.tsx", "utf8"),
    readFile("app/security/analyses/[analysisId]/page.tsx", "utf8"),
    readFile("app/customers/[id]/page.tsx", "utf8"),
    readFile("app/customers/[id]/fortigates/[fortigateId]/page.tsx", "utf8"),
    readFile("app/customers/[id]/fortigates/[fortigateId]/security/page.tsx", "utf8"),
    readFile("lib/security/report.ts", "utf8")
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /TECHNISCHE SCORE \/ 100|score\}\s*\/\s*100/);
  assert.match(combined, /TECHNISCHE SCORE/);
  assert.match(combined, /score\}%/);
  assert.match(combined, /procentpunt/);
});

test("geslaagde controles staan veilig in de online analyse en PDF", async () => {
  const [analysis, report, worker] = await Promise.all([
    readFile("app/security/analyses/[analysisId]/page.tsx", "utf8"),
    readFile("lib/security/report.ts", "utf8"),
    readFile("lib/security/analysis-worker.ts", "utf8")
  ]);
  assert.match(analysis, /Geslaagde controles/);
  assert.match(analysis, /parseStoredScoreComponents/);
  assert.match(report, /Geslaagde controles/);
  assert.match(report, /component\.passed/);
  assert.match(worker, /scoreComponents: local\.scoreComponents/);
});
