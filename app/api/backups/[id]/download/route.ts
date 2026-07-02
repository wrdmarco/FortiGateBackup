import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { backupFilePath, getBackupForUser } from "@/lib/backups";
import { assertPermission, requireTenantUser } from "@/lib/authz";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await requireTenantUser();
  await assertPermission(user, "backups.download");
  const backup = await getBackupForUser(id, user);
  if (!backup.filename) {
    return NextResponse.json({ error: "No backup file stored for this record." }, { status: 404 });
  }
  let fullPath: string;
  try {
    fullPath = backupFilePath(backup.filename);
  } catch {
    return NextResponse.json({ error: "Invalid backup path." }, { status: 400 });
  }
  const content = await readFile(fullPath);
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${path.basename(backup.filename)}"`
    }
  });
}
