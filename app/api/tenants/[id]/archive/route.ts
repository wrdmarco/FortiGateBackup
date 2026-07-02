import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { assertPermission, requireSuperAdmin } from "@/lib/authz";
import { createTenantArchive, restoreTenantArchive } from "@/lib/tenant-archive";
import { mainTenantId } from "@/lib/tenant-main";

async function requireGlobalArchiveAccess() {
  const user = await requireSuperAdmin();
  const globalTenantId = await mainTenantId();
  if (user.activeTenantId !== globalTenantId) {
    throw new Error("Tenant backups zijn alleen beschikbaar vanuit Global.");
  }
  await assertPermission(user, "platform.tenants.export");
  return user;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireGlobalArchiveAccess();
    const { id } = await context.params;
    const globalTenantId = await mainTenantId();
    if (id === globalTenantId) {
      return NextResponse.json({ error: "Global tenant kan niet als klanttenant worden geexporteerd." }, { status: 400 });
    }
    const archive = await createTenantArchive(id);
    await auditLog({
      action: "tenant.exported",
      tenantId: id,
      userId: user.id,
      entity: "Tenant",
      entityId: id
    });
    return new NextResponse(archive.buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tenant backup kon niet worden gemaakt." }, { status: 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireGlobalArchiveAccess();
    const { id } = await context.params;
    const globalTenantId = await mainTenantId();
    if (id === globalTenantId) {
      return NextResponse.json({ error: "Global tenant kan niet als klanttenant worden hersteld." }, { status: 400 });
    }
    const formData = await request.formData();
    const file = formData.get("archive");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload een tenant backup zipbestand." }, { status: 400 });
    }
    await restoreTenantArchive({
      tenantId: id,
      archive: Buffer.from(await file.arrayBuffer()),
      userId: user.id
    });
    return NextResponse.redirect(new URL("/tenants", request.url));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tenant restore is mislukt." }, { status: 400 });
  }
}
