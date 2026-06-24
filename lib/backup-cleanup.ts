import { rm } from "node:fs/promises";
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
  const uniqueFilenames = [...new Set(filenames.filter((filename): filename is string => Boolean(filename)))];
  const uniqueDeviceIds = [...new Set(deviceIds)];

  for (const filename of uniqueFilenames) {
    await rm(backupFilePath(filename), { force: true });
  }
  for (const deviceId of uniqueDeviceIds) {
    await rm(backupDeviceDirectory(deviceId), { recursive: true, force: true });
  }
}
