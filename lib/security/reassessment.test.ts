import assert from "node:assert/strict";
import test from "node:test";
import { canShowReassessment } from "@/lib/security/reassessment";

const eligible = {
  globalOrigin: true,
  hasPermission: true,
  hasStoredArtifact: true,
  analysisStatus: "COMPLETED",
  hasReport: true
};

test("toont herbeoordeling voor een bevoegde Global-admin bij iedere opgeslagen backup met rapport", () => {
  assert.equal(canShowReassessment(eligible), true);
});

test("verbergt herbeoordeling buiten Global, zonder permission of zonder immutable rapport", () => {
  assert.equal(canShowReassessment({ ...eligible, globalOrigin: false }), false);
  assert.equal(canShowReassessment({ ...eligible, hasPermission: false }), false);
  assert.equal(canShowReassessment({ ...eligible, hasReport: false }), false);
  assert.equal(canShowReassessment({ ...eligible, hasStoredArtifact: false }), false);
});
