type ZipEntryInput = {
  name: string;
  data: Buffer | string;
};

export type StoreZipLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalUncompressedBytes: number;
  maxEntryNameBytes: number;
};

export const DEFAULT_STORE_ZIP_LIMITS: Readonly<StoreZipLimits> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 20_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxEntryNameBytes: 240
});

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const END_RECORD_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function resolveLimits(overrides: Partial<StoreZipLimits> = {}): StoreZipLimits {
  const limits = { ...DEFAULT_STORE_ZIP_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Ongeldige ziplimiet: ${name}.`);
  }
  return limits;
}

function assertRange(buffer: Buffer, offset: number, length: number, message: string) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(message);
  }
}

function canonicalEntryName(value: string, maxBytes: number) {
  if (!value || value !== value.normalize("NFC")) throw new Error("Zip bevat een niet-canonieke bestandsnaam.");
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("Zip bevat een te lange bestandsnaam.");
  if (value.includes("\\") || value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Zip bevat een ongeldige bestandsnaam.");
  }
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.endsWith("/")) {
    throw new Error("Zip bevat een ongeldig pad.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Zip bevat een ongeldig pad.");
  }
  return value;
}

function decodeEntryName(nameBytes: Buffer, maxBytes: number) {
  if (nameBytes.length === 0 || nameBytes.length > maxBytes) throw new Error("Zip bevat een ongeldige bestandsnaam.");
  const name = nameBytes.toString("utf8");
  if (!Buffer.from(name, "utf8").equals(nameBytes)) throw new Error("Zip bevat een ongeldige UTF-8 bestandsnaam.");
  return canonicalEntryName(name, maxBytes);
}

function writeLocalHeader(name: Buffer, data: Buffer, crc: number) {
  const { time, day } = dosDateTime();
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.byteLength, 18);
  header.writeUInt32LE(data.byteLength, 22);
  header.writeUInt16LE(name.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function writeCentralHeader(name: Buffer, data: Buffer, crc: number, offset: number) {
  const { time, day } = dosDateTime();
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.byteLength, 20);
  header.writeUInt32LE(data.byteLength, 24);
  header.writeUInt16LE(name.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

export function createStoreZip(entries: ZipEntryInput[], limitOverrides: Partial<StoreZipLimits> = {}) {
  const limits = resolveLimits(limitOverrides);
  if (entries.length > limits.maxEntries || entries.length > 0xffff) throw new Error("Zip bevat te veel bestanden.");

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;
  let totalUncompressedBytes = 0;

  for (const entry of entries) {
    const safeName = canonicalEntryName(entry.name, limits.maxEntryNameBytes);
    const comparisonName = safeName.toLowerCase();
    if (names.has(comparisonName)) throw new Error(`Dubbele zip-entry: ${safeName}.`);
    names.add(comparisonName);

    const name = Buffer.from(safeName, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    if (data.byteLength > limits.maxEntryBytes) throw new Error(`Zip-entry is te groot: ${safeName}.`);
    totalUncompressedBytes += data.byteLength;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) throw new Error("Zip bevat te veel ongecomprimeerde data.");

    const crc = crc32(data);
    const localHeader = writeLocalHeader(name, data, crc);
    localParts.push(localHeader, name, data);
    centralParts.push(writeCentralHeader(name, data, crc, offset), name);
    offset += localHeader.byteLength + name.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const archiveBytes = centralOffset + central.byteLength + END_RECORD_BYTES;
  if (archiveBytes > limits.maxArchiveBytes || archiveBytes > 0xffffffff) throw new Error("Zipbestand is te groot.");

  const end = Buffer.alloc(END_RECORD_BYTES);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, end], archiveBytes);
}

function findEndRecord(buffer: Buffer) {
  const earliest = Math.max(0, buffer.length - END_RECORD_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = buffer.length - END_RECORD_BYTES; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== END_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + END_RECORD_BYTES + commentLength === buffer.length) return offset;
  }
  throw new Error("Ongeldig zipbestand: eindrecord ontbreekt.");
}

export function readStoreZip(buffer: Buffer, limitOverrides: Partial<StoreZipLimits> = {}) {
  const limits = resolveLimits(limitOverrides);
  if (buffer.length < END_RECORD_BYTES || buffer.length > limits.maxArchiveBytes) {
    throw new Error(buffer.length > limits.maxArchiveBytes ? "Zipbestand is te groot." : "Ongeldig zipbestand.");
  }

  const endOffset = findEndRecord(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntryCount = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("Meerdelige zipbestanden worden niet ondersteund.");
  }
  if (entryCount > limits.maxEntries) throw new Error("Zip bevat te veel bestanden.");
  assertRange(buffer, centralDirectoryOffset, centralSize, "Ongeldige zip index.");
  if (centralDirectoryOffset + centralSize !== endOffset) throw new Error("Ongeldige zip indexgrootte.");
  if (entryCount > 0 && (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE)) {
    throw new Error("Ongeldige zip magic.");
  }

  const entries = new Map<string, Buffer>();
  const comparisonNames = new Set<string>();
  let centralOffset = centralDirectoryOffset;
  let expectedLocalOffset = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(buffer, centralOffset, 46, "Afgeknotte zip index.");
    if (buffer.readUInt32LE(centralOffset) !== CENTRAL_FILE_SIGNATURE) throw new Error("Ongeldige zip index.");

    const flags = buffer.readUInt16LE(centralOffset + 8);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const expectedCrc = buffer.readUInt32LE(centralOffset + 16);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const startDisk = buffer.readUInt16LE(centralOffset + 34);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    if (flags !== UTF8_FLAG || method !== 0 || extraLength !== 0 || commentLength !== 0 || startDisk !== 0) {
      throw new Error("Alleen ongewijzigde tenant exports uit dit portaal kunnen worden geimporteerd.");
    }
    if (compressedSize !== uncompressedSize) throw new Error("Ongeldige STORE zip-entry.");
    if (uncompressedSize > limits.maxEntryBytes) throw new Error("Zip-entry is te groot.");
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) throw new Error("Zip bevat te veel ongecomprimeerde data.");

    assertRange(buffer, centralOffset + 46, nameLength, "Afgeknotte zip bestandsnaam.");
    const centralNameBytes = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength);
    const name = decodeEntryName(centralNameBytes, limits.maxEntryNameBytes);
    const comparisonName = name.toLowerCase();
    if (comparisonNames.has(comparisonName)) throw new Error(`Dubbele zip-entry: ${name}.`);
    comparisonNames.add(comparisonName);

    if (localOffset !== expectedLocalOffset) throw new Error("Zip bevat verborgen of overlappende entries.");
    assertRange(buffer, localOffset, 30, "Afgeknotte lokale zip-header.");
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) throw new Error("Ongeldige lokale zip-header.");
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localCrc !== expectedCrc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localExtraLength !== 0 ||
      localNameLength !== nameLength
    ) {
      throw new Error("Lokale zip-header komt niet overeen met de index.");
    }

    assertRange(buffer, localOffset + 30, localNameLength, "Afgeknotte lokale zip bestandsnaam.");
    const localNameBytes = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!localNameBytes.equals(centralNameBytes)) throw new Error("Zip bestandsnamen komen niet overeen.");
    const dataStart = localOffset + 30 + localNameLength;
    assertRange(buffer, dataStart, compressedSize, "Afgeknotte zip-entry.");
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (crc32(data) !== expectedCrc) throw new Error(`CRC-controle mislukt voor ${name}.`);

    entries.set(name, data);
    expectedLocalOffset = dataStart + compressedSize;
    centralOffset += 46 + nameLength;
  }

  if (centralOffset !== endOffset || expectedLocalOffset !== centralDirectoryOffset) {
    throw new Error("Zipstructuur bevat niet-geindexeerde data.");
  }
  return entries;
}
