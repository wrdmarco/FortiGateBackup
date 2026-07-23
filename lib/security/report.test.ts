import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { generateSecurityReport } from "./report";
import { removeVerifiedReportArtifact, verifyImmutableArtifact } from "./artifact-storage";
import { sha256 } from "@/lib/crypto";
import type { LocalFinding } from "./rules";

test("genereert een geldig meerpagina-PDF zonder ruwe configuratie of secrets", async () => {
  const testRoot = path.join(process.cwd(), "data", "backups", "tenant_test");
  await rm(testRoot, { recursive: true, force: true });
  const findings: LocalFinding[] = Array.from({ length: 30 }, (_, index) => ({
    ruleId: `FG-POL-${String(index + 1).padStart(3, "0")}`,
    category: "Firewallbeleid",
    severity: index < 2 ? "CRITICAL" : index < 8 ? "HIGH" : "MEDIUM",
    penalty: 1,
    title: `Bevinding ${index + 1}`,
    explanation: "Een synthetische semantische constatering zonder configuratieregels. ".repeat(4),
    evidence: `POLICY_${index + 1}: bronclassificatie ANY, bestemming ANY`,
    remediation: "Beperk het beleid tot de aantoonbaar noodzakelijke verkeersstroom. ".repeat(3),
  }));
  const { buffer: pdf } = await generateSecurityReport({
    reportId: "report_test",
    tenantId: "tenant_test",
    tenantName: "Synthetische tenant",
    customerName: "Synthetische klant",
    fortigateId: "fortigate_test",
    hostname: "FG-TEST",
    model: "FortiGate testmodel",
    fortiOsVersion: "7.4.x",
    configDate: new Date("2026-01-01T12:00:00.000Z"),
    analysisDate: new Date("2026-01-02T12:00:00.000Z"),
    score: 72,
    scoreDelta: 4,
    passedControls: 18,
    totalControls: 25,
    scoreComponents: [{ ruleId: "FG-LOG-001", category: "Logging", title: "Verkeerslogging is actief", passed: 18, failed: 2, earned: 90, possible: 100 }],
    hash: "a".repeat(64),
    parserVersion: "1.0.0",
    rulesetVersion: "1.0.0",
    summary: "Veilige, synthetische managementsamenvatting.",
    findings,
    newFindingIds: ["FG-POL-001"],
    resolvedFindingIds: ["FG-OLD-001"],
  });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 10_000);
  assert.match(pdf.toString("latin1"), /\/Type\s*\/Page\b/);
  assert.doesNotMatch(pdf.toString("latin1"), /synthetic-secret|config firewall policy|set password/i);
  if (process.env.KEEP_PDF_FIXTURE !== "1") await rm(testRoot, { recursive: true, force: true });
});

test("bouwt een vervangend rapport naast het bestaande en verwijdert alleen hash-geverifieerd", async () => {
  const testRoot = path.join(process.cwd(), "data", "backups", "tenant_replacement");
  await rm(testRoot, { recursive: true, force: true });
  const common = {
    tenantId:"tenant_replacement",tenantName:"Tenant",customerName:"Klant",fortigateId:"fortigate_replacement",
    hostname:"FG",model:"FortiGate",fortiOsVersion:"7.4.x",configDate:new Date("2026-01-01T00:00:00Z"),
    analysisDate:new Date("2026-01-02T00:00:00Z"),score:100,scoreDelta:null,passedControls:1,totalControls:1,
    scoreComponents:[],hash:"b".repeat(64),parserVersion:"1",rulesetVersion:"1",summary:"Veilig",
    findings:[] as LocalFinding[],newFindingIds:[] as string[],resolvedFindingIds:[] as string[]
  };
  const original=await generateSecurityReport({reportId:"original",...common});
  const replacement=await generateSecurityReport({reportId:"replacement",...common,replacement:true});
  assert.notEqual(original.relative,replacement.relative);
  await verifyImmutableArtifact(original.relative,sha256(original.buffer),original.buffer.length);
  await verifyImmutableArtifact(replacement.relative,sha256(replacement.buffer),replacement.buffer.length);
  await removeVerifiedReportArtifact(original.relative,sha256(original.buffer),original.buffer.length);
  await assert.rejects(()=>verifyImmutableArtifact(original.relative,sha256(original.buffer),original.buffer.length));
  await verifyImmutableArtifact(replacement.relative,sha256(replacement.buffer),replacement.buffer.length);
  await rm(testRoot,{recursive:true,force:true});
});
