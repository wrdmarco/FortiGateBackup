import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("components/ui.tsx", "utf8");
const switcher = readFileSync("components/tenant-switcher.tsx", "utf8");

test("mobiele header bevat een volledige tenantswitcher", () => {
  assert.match(shell, /lg:hidden/);
  assert.match(shell, /id="tenant-context-mobile"/);
  assert.match(shell, /fullWidth/);
  assert.match(shell, /switchTenantContextAction/);
});

test("desktop- en mobiele switchers gebruiken unieke toegankelijke ids", () => {
  assert.match(switcher, /id = "tenant-context"/);
  assert.match(switcher, /htmlFor=\{id\}/);
  assert.match(switcher, /id=\{id\}/);
  assert.match(shell, /desktop-\$\{user\.activeTenantId/);
  assert.match(shell, /mobile-\$\{user\.activeTenantId/);
});
