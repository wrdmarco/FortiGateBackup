import assert from "node:assert/strict";
import test from "node:test";
import { backupMethodsForFirmware } from "./fortigate";

test("FortiOS 7.6 gebruikt POST als eerste backupmethode", () => {
  assert.deepEqual(backupMethodsForFirmware("v7.6.4"), ["POST", "GET"]);
  assert.deepEqual(backupMethodsForFirmware("7.6.0"), ["POST", "GET"]);
});

test("oudere FortiOS-versies behouden GET als eerste backupmethode", () => {
  assert.deepEqual(backupMethodsForFirmware("v7.4.8"), ["GET", "POST"]);
  assert.deepEqual(backupMethodsForFirmware("6.4.15"), ["GET", "POST"]);
});

test("onbekende firmware kiest de moderne methode met GET als fallback", () => {
  assert.deepEqual(backupMethodsForFirmware(null), ["POST", "GET"]);
});
