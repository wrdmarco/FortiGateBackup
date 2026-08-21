import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("FortiGate configuration ID is only shown when IT Glue is enabled", async () => {
  const [wizard, editPage] = await Promise.all([
    readFile("components/fortigate-wizard.tsx", "utf8"),
    readFile("app/customers/[id]/fortigates/[fortigateId]/edit/page.tsx", "utf8")
  ]);

  assert.match(wizard, /name="itGlueConfigurationId"/);
  assert.match(wizard, /\{itGlueEnabled \? \(\s*<label[^>]*>\s*<span[^>]*>IT Glue configuration ID/);
  assert.match(editPage, /\{itGlueEnabled \? \(\s*<Field label="IT Glue configuration ID"/);
});

test("form feedback keeps spacing outside the bold status label", async () => {
  const feedback = await readFile("components/form-feedback.tsx", "utf8");

  assert.match(feedback, /"Gelukt:" : "Niet gelukt:"/);
  assert.match(feedback, /<\/span>\{" "\}\s*<span>\{state\.message\}<\/span>/);
});

test("certificate acceptance never requires a wizard interaction", async () => {
  const wizard = await readFile("components/fortigate-wizard.tsx", "utf8");

  assert.doesNotMatch(wizard, /acceptedTlsFingerprint/);
  assert.doesNotMatch(wizard, /Certificaat accepteren en FortiGate opslaan/);
  assert.match(wizard, /alle aangeboden certificaten worden automatisch geaccepteerd/);
});
