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
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const maxCells = oldLines.length * newLines.length;
  const body =
    maxCells <= 2_000_000
      ? lcsDiff(oldLines, newLines)
      : positionalDiff(oldLines, newLines);
  return [`--- ${oldLabel}`, `+++ ${newLabel}`, ...body].join("\n");
}

function lcsDiff(oldLines: string[], newLines: string[]) {
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

  const lines = ["@@ config @@"];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push(` ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`-${oldLines[i]}`);
      i += 1;
    } else {
      lines.push(`+${newLines[j]}`);
      j += 1;
    }
  }
  while (i < oldLines.length) {
    lines.push(`-${oldLines[i]}`);
    i += 1;
  }
  while (j < newLines.length) {
    lines.push(`+${newLines[j]}`);
    j += 1;
  }
  return lines;
}

function positionalDiff(oldLines: string[], newLines: string[]) {
  const lines = ["@@ config (large file positional diff) @@"];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] === newLines[i]) {
      lines.push(` ${oldLines[i] ?? ""}`);
    } else {
      if (oldLines[i] !== undefined) lines.push(`-${oldLines[i]}`);
      if (newLines[i] !== undefined) lines.push(`+${newLines[i]}`);
    }
  }
  return lines;
}
