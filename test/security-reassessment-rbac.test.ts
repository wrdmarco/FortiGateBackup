import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rbac = readFileSync("lib/rbac.ts", "utf8");

test("opnieuw beoordelen heeft een afzonderlijke RBAC-permission", () => {
  assert.match(rbac, /security\.analyses\.reassess/);
  assert.match(rbac, /voltooide analyse van een gewijzigde backup opnieuw beoordelen/);
});

test("de standaard Operator krijgt herbeoordelen niet automatisch", () => {
  const operator = rbac.match(/const operatorPermissionKeys = \[([\s\S]*?)\]\s+satisfies/)?.[1] ?? "";
  assert.doesNotMatch(operator, /security\.analyses\.reassess/);
});
