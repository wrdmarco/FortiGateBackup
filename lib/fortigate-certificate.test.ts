import assert from "node:assert/strict";
import test from "node:test";
import { certificateFingerprintMatches } from "./fortigate";

test("certificaatpin accepteert uitsluitend exact dezelfde SHA-256 fingerprint", () => {
  const fingerprint = "AA:BB:CC:DD:EE:FF";
  assert.equal(certificateFingerprintMatches(fingerprint, "aabbccddeeff"), true);
  assert.equal(certificateFingerprintMatches(fingerprint, "AA:BB:CC:DD:EE:00"), false);
  assert.equal(certificateFingerprintMatches(fingerprint, null), false);
});
