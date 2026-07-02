import { NextRequest, NextResponse } from "next/server";
import { assertPermission, requireSuperAdmin } from "@/lib/authz";
import { restoreTenantArchive, tenantIdFromArchive } from "@/lib/tenant-archive";
import { mainTenantId } from "@/lib/tenant-main";

async function requireGlobalArchiveAccess() {
  const user = await requireSuperAdmin();
  const globalTenantId = await mainTenantId();
  if (user.activeTenantId !== globalTenantId) {
    throw new Error("Tenant restore is alleen beschikbaar vanuit Global.");
  }
  await assertPermission(user, "platform.tenants.export");
  return { user, globalTenantId };
}

export async function POST(request: NextRequest) {
  try {
    const { user, globalTenantId } = await requireGlobalArchiveAccess();
    const formData = await request.formData();
    const file = formData.get("archive");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload een tenant backup zipbestand." }, { status: 400 });
    }
    const archive = Buffer.from(await file.arrayBuffer());
    const tenantId = tenantIdFromArchive(archive);
    if (tenantId === globalTenantId) {
      return NextResponse.json({ error: "Global tenant kan niet als klanttenant worden hersteld." }, { status: 400 });
    }
    await restoreTenantArchive({
      tenantId,
      archive,
      userId: user.id,
      createTenantIfMissing: true
    });
    return NextResponse.redirect(new URL("/tenants", request.url));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tenant restore is mislukt." }, { status: 400 });
  }
}
