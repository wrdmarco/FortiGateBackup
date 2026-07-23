import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("de applicatie-inhoud blijft links uitgelijnd op brede schermen", () => {
  const shell = readFileSync("components/ui.tsx", "utf8");
  const main = shell.match(/<main className="([^"]+)"/)?.[1] ?? "";

  assert.match(main, /\bmr-auto\b/);
  assert.doesNotMatch(main, /\bmx-auto\b/);
  assert.match(main, /(?:^|\s)max-w-\[1680px\](?:\s|$)/);
});
