import assert from "node:assert/strict";
import test from "node:test";
import { createStoreZip, readStoreZip } from "./zip-store";

function replaceAll(source: Buffer, from: string, to: string) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
  const result = Buffer.from(source);
  const needle = Buffer.from(from);
  const replacement = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(needle, offset)) >= 0) {
    replacement.copy(result, offset);
    offset += replacement.length;
    replacements += 1;
  }
  return { result, replacements };
}

test("STORE zip roundtrip valideert en leest entries", () => {
  const archive = createStoreZip([
    { name: "manifest.json", data: "{}" },
    { name: "customers/acme/backups/config.conf", data: "config system global\nend\n" }
  ]);

  const entries = readStoreZip(archive);
  assert.equal(entries.get("manifest.json")?.toString("utf8"), "{}");
  assert.equal(entries.get("customers/acme/backups/config.conf")?.toString("utf8"), "config system global\nend\n");
});

test("writer weigert traversal en hoofdletter-onafhankelijke duplicaten", () => {
  assert.throws(() => createStoreZip([{ name: "../manifest.json", data: "{}" }]), /ongeldig pad/i);
  assert.throws(
    () =>
      createStoreZip([
        { name: "Manifest.json", data: "a" },
        { name: "manifest.json", data: "b" }
      ]),
    /Dubbele zip-entry/
  );
});

test("reader weigert gemanipuleerde traversal-paden", () => {
  const archive = createStoreZip([{ name: "safe", data: "data" }]);
  const { result, replacements } = replaceAll(archive, "safe", "../x");
  assert.equal(replacements, 2);
  assert.throws(() => readStoreZip(result), /ongeldig pad/i);
});

test("reader weigert dubbele namen uit een gemanipuleerde centrale index", () => {
  const archive = createStoreZip([
    { name: "a.txt", data: "first" },
    { name: "b.txt", data: "second" }
  ]);
  const { result, replacements } = replaceAll(archive, "b.txt", "a.txt");
  assert.equal(replacements, 2);
  assert.throws(() => readStoreZip(result), /Dubbele zip-entry/);
});

test("reader controleert CRC32 van iedere entry", () => {
  const archive = createStoreZip([{ name: "manifest.json", data: "unique-payload" }]);
  const corrupted = Buffer.from(archive);
  const dataOffset = corrupted.indexOf(Buffer.from("unique-payload"));
  assert.ok(dataOffset > 0);
  corrupted[dataOffset] ^= 0xff;
  assert.throws(() => readStoreZip(corrupted), /CRC-controle mislukt/);
});

test("reader vergelijkt lokale en centrale bestandsnamen", () => {
  const archive = createStoreZip([{ name: "a.txt", data: "payload" }]);
  const tampered = Buffer.from(archive);
  const localNameOffset = tampered.indexOf(Buffer.from("a.txt"));
  assert.ok(localNameOffset > 0);
  Buffer.from("b.txt").copy(tampered, localNameOffset);
  assert.throws(() => readStoreZip(tampered), /bestandsnamen komen niet overeen/);
});

test("reader weigert afgeknotte archieven en harde limietoverschrijdingen", () => {
  const archive = createStoreZip([
    { name: "one", data: "1" },
    { name: "two", data: "2" }
  ]);
  assert.throws(() => readStoreZip(archive.subarray(0, archive.length - 1)), /eindrecord ontbreekt/);
  assert.throws(() => readStoreZip(archive, { maxEntries: 1 }), /te veel bestanden/);
  assert.throws(() => readStoreZip(archive, { maxTotalUncompressedBytes: 1 }), /te veel ongecomprimeerde data/);
});
