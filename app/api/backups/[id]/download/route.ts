import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertTenantAccess, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await requireTenantUser();
  const backup = await prisma.backup.findUniqueOrThrow({
    where: { id },
    include: { fortigate: { include: { customer: true } } }
  });
  assertTenantAccess(user, backup.fortigate.customer.tenantId);
  if (!backup.filename) {
    return NextResponse.json({ error: "No backup file stored for this record." }, { status: 404 });
  }
  const backupRoot = path.resolve(process.cwd(), "data", "backups");
  const fullPath = path.resolve(process.cwd(), backup.filename);
  if (!fullPath.startsWith(`${backupRoot}${path.sep}`)) {
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
