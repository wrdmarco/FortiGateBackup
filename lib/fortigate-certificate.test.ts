import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { certificateFingerprintMatches, peerCertificateFingerprint } from "./fortigate";

test("certificaatpin accepteert uitsluitend exact dezelfde SHA-256 fingerprint", () => {
  const fingerprint = "AA:BB:CC:DD:EE:FF";
  assert.equal(certificateFingerprintMatches(fingerprint, "aabbccddeeff"), true);
  assert.equal(certificateFingerprintMatches(fingerprint, "AA:BB:CC:DD:EE:00"), false);
  assert.equal(certificateFingerprintMatches(fingerprint, null), false);
});

test("certificaatpin wordt canoniek uit het ruwe leaf-certificaat berekend", () => {
  assert.equal(
    peerCertificateFingerprint({ raw: Buffer.from("fortigate-leaf-certificate"), fingerprint256: "00:11" }),
    "6CAC0F5484E57650D3811A6DA1DBE70CCF87D7DE3AA4432F4F250E76779CBB76"
  );
});

test("gepinde self-signed verbindingen gebruiken een verse TLS-socket", () => {
  const source=readFileSync("lib/fortigate.ts","utf8");
  assert.match(source,/agent: false/);
  assert.match(source,/rejectUnauthorized: !pinnedFingerprint/);
});
