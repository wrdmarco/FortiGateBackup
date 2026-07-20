import crypto from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { backupFilePath } from "@/lib/backups";

function backupDeviceDirectory(deviceId: string) {
  const backupRoot = path.resolve(process.cwd(), "data", "backups");
  const fullPath = path.resolve(backupRoot, deviceId);
  if (!fullPath.startsWith(`${backupRoot}${path.sep}`)) {
    throw new Error("Invalid backup directory.");
  }
  return fullPath;
}

export async function removeBackupFiles({
  deviceIds,
  filenames
}: {
  deviceIds: string[];
  filenames: Array<string | null>;
}) {
  const staged = await stageBackupFiles({ deviceIds, filenames });
  await staged.commit();
}

export async function stageBackupFiles({
  deviceIds,
  filenames
}: {
  deviceIds: string[];
  filenames: Array<string | null>;
}) {
  const uniqueFilenames = [...new Set(filenames.filter((filename): filename is string => Boolean(filename)))];
  const uniqueDeviceIds = [...new Set(deviceIds)];
  const deviceDirectories = uniqueDeviceIds.map(backupDeviceDirectory);
  const filePaths = uniqueFilenames
    .map(backupFilePath)
    .filter((filename) => !deviceDirectories.some((directory) => filename === directory || filename.startsWith(`${directory}${path.sep}`)));
  const targets = [...deviceDirectories, ...filePaths];
  const quarantineRoot = path.resolve(process.cwd(), "data", "quarantine", crypto.randomUUID());
  const moved: Array<{ source: string; staged: string }> = [];

  await mkdir(quarantineRoot, { recursive: true });
  try {
    for (const [index, source] of targets.entries()) {
      const staged = path.join(quarantineRoot, String(index));
      try {
        await rename(source, staged);
        moved.push({ source, staged });
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    }
  } catch (error) {
    await restoreMovedFiles(moved);
    await rm(quarantineRoot, { recursive: true, force: true });
    throw error;
  }

  let finalized = false;
  return {
    async commit() {
      if (finalized) return;
      finalized = true;
      await rm(quarantineRoot, { recursive: true, force: true });
    },
    async rollback() {
      if (finalized) return;
      await restoreMovedFiles(moved);
      finalized = true;
      await rm(quarantineRoot, { recursive: true, force: true });
    }
  };
}

async function restoreMovedFiles(moved: Array<{ source: string; staged: string }>) {
  for (const item of [...moved].reverse()) {
    await mkdir(path.dirname(item.source), { recursive: true });
    await rename(item.staged, item.source);
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
