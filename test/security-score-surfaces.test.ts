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
  assert.doesNotMatch(page, /<ActionLink href="\/customers">Klanten<\/ActionLink>/);
});

test("FortiGate-detail toont actuele score en lokale historie", async () => {
  const page = await readFile(path.join(process.cwd(), "app/customers/[id]/fortigates/[fortigateId]/page.tsx"), "utf8");
  assert.match(page, /fortigateSecuritySnapshot/);
  assert.match(page, /SecurityScoreChart/);
  assert.match(page, /Open analyse/);
  assert.match(page, /Volledige scorehistorie/);
  assert.doesNotMatch(page, />Klant<\/ActionLink>/);
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

test("geslaagde controles verschijnen als veilige INFO-regels online en in de PDF", async () => {
  const [analysis, report, worker] = await Promise.all([
    readFile("app/security/analyses/[analysisId]/page.tsx", "utf8"),
    readFile("lib/security/report.ts", "utf8"),
    readFile("lib/security/analysis-worker.ts", "utf8")
  ]);
  assert.doesNotMatch(analysis, /<h2[^>]*>Geslaagde controles/);
  assert.match(analysis, /parseStoredScoreComponents/);
  assert.match(analysis, />INFO</);
  assert.match(analysis, /severityRank/);
  assert.ok(analysis.indexOf("analysis.findings") < analysis.indexOf("informationalControls.map"));
  assert.match(report, /"INFO"/);
  assert.ok(report.indexOf("for(const finding") < report.indexOf("for(const component"));
  assert.match(report, /component\.passed/);
  assert.match(worker, /scoreComponents: local\.scoreComponents/);
});
