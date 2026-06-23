import { readFile } from "node:fs/promises";
import path from "node:path";
import { Backup, User } from "@prisma/client";
import { assertTenantAccess } from "@/lib/authz";
import { prisma } from "@/lib/db";

type BackupWithDevice = Backup & {
  fortigate: {
    id: string;
    hostname: string | null;
    managementUrl: string;
    customer: {
      id: string;
      name: string;
      tenantId: string;
    };
  };
};

export function backupDisplayName(backup: Pick<BackupWithDevice, "filename" | "id">) {
  return backup.filename ? path.basename(backup.filename) : `${backup.id}.conf`;
}

export function backupFilePath(filename: string) {
  const backupRoot = path.resolve(process.cwd(), "data", "backups");
  const fullPath = path.resolve(process.cwd(), filename);
  if (!fullPath.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error("Invalid backup path.");
  }
  return fullPath;
}

export async function getBackupForUser(id: string, user: Pick<User, "role" | "tenantId">) {
  const backup = await prisma.backup.findUniqueOrThrow({
    where: { id },
    include: { fortigate: { include: { customer: true } } }
  });
  assertTenantAccess(user, backup.fortigate.customer.tenantId);
  return backup;
}

export async function readBackupText(backup: Pick<BackupWithDevice, "filename">) {
  if (!backup.filename) throw new Error("No backup file stored for this record.");
  return readFile(backupFilePath(backup.filename), "utf8");
}

export async function previousStoredBackup(backup: BackupWithDevice) {
  return prisma.backup.findFirst({
    where: {
      fortigateId: backup.fortigateId,
      filename: { not: null },
      createdAt: { lt: backup.createdAt }
    },
    orderBy: { createdAt: "desc" },
    include: { fortigate: { include: { customer: true } } }
  });
}

export function unifiedDiff(oldText: string, newText: string, oldLabel: string, newLabel: string) {
  const oldLines = meaningfulConfigLines(oldText);
  const newLines = meaningfulConfigLines(newText);
  const maxCells = oldLines.length * newLines.length;
  const body =
    maxCells <= 2_000_000
      ? compactHunks(lcsOperations(oldLines, newLines))
      : compactHunks(positionalOperations(oldLines, newLines));
  if (body.length === 0) {
    return [
      `--- ${oldLabel}`,
      `+++ ${newLabel}`,
      "Geen inhoudelijke wijzigingen gevonden na het negeren van FortiGate export-metadata."
    ].join("\n");
  }
  return [`--- ${oldLabel}`, `+++ ${newLabel}`, ...body].join("\n");
}

type DiffOperation = {
  type: "same" | "add" | "remove";
  line: string;
  oldLine?: number;
  newLine?: number;
};

const VOLATILE_CONFIG_LINE_PATTERNS = [
  /^#\s*config-version=/i,
  /^#\s*conf_file_ver=/i,
  /^#\s*buildno=/i,
  /^#\s*global_vdom=/i,
  /^#\s*checksum/i,
  /^#\s*backup(?:\s|-)?time/i,
  /^#\s*generated/i
];

function meaningfulConfigLines(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !VOLATILE_CONFIG_LINE_PATTERNS.some((pattern) => pattern.test(line.trim())));
}

function lcsOperations(oldLines: string[], newLines: string[]) {
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const operations: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      operations.push({ type: "same", line: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({ type: "remove", line: oldLines[i], oldLine: i + 1 });
      i += 1;
    } else {
      operations.push({ type: "add", line: newLines[j], newLine: j + 1 });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    operations.push({ type: "remove", line: oldLines[i], oldLine: i + 1 });
    i += 1;
  }
  while (j < newLines.length) {
    operations.push({ type: "add", line: newLines[j], newLine: j + 1 });
    j += 1;
  }
  return operations;
}

function positionalOperations(oldLines: string[], newLines: string[]) {
  const operations: DiffOperation[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] === newLines[i]) {
      operations.push({ type: "same", line: oldLines[i] ?? "", oldLine: i + 1, newLine: i + 1 });
    } else {
      if (oldLines[i] !== undefined) operations.push({ type: "remove", line: oldLines[i], oldLine: i + 1 });
      if (newLines[i] !== undefined) operations.push({ type: "add", line: newLines[i], newLine: i + 1 });
    }
  }
  return operations;
}

function compactHunks(operations: DiffOperation[], context = 3) {
  const changed = operations
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => operation.type !== "same")
    .map(({ index }) => index);
  if (changed.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(operations.length - 1, index + context);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const lines: string[] = [];
  for (const range of ranges) {
    const hunk = operations.slice(range.start, range.end + 1);
    const oldStart = firstLine(hunk, "oldLine");
    const newStart = firstLine(hunk, "newLine");
    const oldCount = hunk.filter((operation) => operation.type !== "add").length;
    const newCount = hunk.filter((operation) => operation.type !== "remove").length;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const operation of hunk) {
      const prefix = operation.type === "add" ? "+" : operation.type === "remove" ? "-" : " ";
      lines.push(`${prefix}${operation.line}`);
    }
  }
  return lines;
}

function firstLine(hunk: DiffOperation[], key: "oldLine" | "newLine") {
  return hunk.find((operation) => operation[key] !== undefined)?.[key] ?? 1;
}
