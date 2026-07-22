import assert from "node:assert/strict";
import test from "node:test";
import { convertLegacyValue } from "./legacy-value-conversion";

test("converteert Prisma SQLite milliseconden exact naar UTC", () => {
  const value = 1_753_184_878_098;
  assert.equal((convertLegacyValue(value, "timestamp with time zone", "AuditLog.createdAt") as Date).toISOString(), "2025-07-22T11:47:58.098Z");
  assert.equal((convertLegacyValue(String(value), "timestamp with time zone", "AuditLog.createdAt") as Date).getTime(), value);
});

test("behandelt SQLite CURRENT_TIMESTAMP-tekst expliciet als UTC", () => {
  const converted = convertLegacyValue("2026-07-22 12:47:58.098", "timestamp with time zone", "Backup.createdAt") as Date;
  assert.equal(converted.toISOString(), "2026-07-22T12:47:58.098Z");
});

test("meldt alleen tabel en kolom bij een ongeldige timestamp", () => {
  assert.throws(
    () => convertLegacyValue("synthetic-invalid-value", "timestamp with time zone", "Backup.createdAt"),
    { message: "INVALID_LEGACY_TIMESTAMP:Backup.createdAt" }
  );
});
