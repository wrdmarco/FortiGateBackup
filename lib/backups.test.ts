import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { backupFilePath, unifiedDiff } from "@/lib/backups";

test("backupbestandspaden blijven binnen data/backups", () => {
  assert.equal(
    backupFilePath("data/backups/firewall-1/backup.conf"),
    path.resolve(process.cwd(), "data", "backups", "firewall-1", "backup.conf")
  );

  for (const filename of [
    "next.config.ts",
    "data/backups/../next.config.ts",
    "data/backups/",
    "data\\backups\\..\\next.config.ts",
    "C:\\Windows\\system.ini"
  ]) {
    assert.throws(() => backupFilePath(filename), /Invalid backup path/);
  }
});

test("FortiGate-diff markeert verwijderde en toegevoegde configuratieregels", () => {
  const diff = unifiedDiff("config system global\nset hostname old\nend", "config system global\nset hostname new\nend", "oud", "nieuw");
  assert.match(diff, /^--- oud\n\+\+\+ nieuw/m);
  assert.match(diff, /^-set hostname old$/m);
  assert.match(diff, /^\+set hostname new$/m);
});
