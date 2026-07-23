import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("topbar en sidebar delen exact dezelfde navigatiekleur", () => {
  const shell = readFileSync("components/ui.tsx", "utf8");
  assert.match(shell, /<aside className="[^"]*bg-\[hsl\(var\(--header\)\)\]/);
  assert.match(shell, /<header className="[^"]*bg-\[hsl\(var\(--header\)\)\]/);
});

test("werkruimte gebruikt een afzonderlijke lichtere themakleur", () => {
  const shell = readFileSync("components/ui.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(shell, /bg-\[hsl\(var\(--workspace\)\)\]/);
  assert.match(css, /--workspace:/);
});

test("licht thema gebruikt ook lichte navigatiebalken en een donker thema blijft donker", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const shell = readFileSync("components/ui.tsx", "utf8");
  assert.match(css, /:root\s*\{[\s\S]*--header:\s*0 0% 100%/);
  assert.match(css, /\.dark\s*\{[\s\S]*--header:\s*220 59% 7%/);
  assert.match(shell, /forti-backup-mark-light\.svg/);
  assert.match(shell, /forti-backup-mark-dark\.svg/);
  assert.match(shell, /dark:hidden/);
});
