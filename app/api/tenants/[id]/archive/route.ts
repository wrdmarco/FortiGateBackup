import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { createTenantArchive, restoreTenantArchive } from "@/lib/tenant-archive";
import { mainTenantId } from "@/lib/tenant-main";
import {
  archiveErrorResponse,
  readArchiveUpload,
  redirectToTenants,
  requireGlobalArchiveAccess
} from "@/app/api/tenants/archive/_shared";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireGlobalArchiveAccess("export");
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
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Tenant-Archive-Integrity": "HMAC-SHA256",
        "X-Tenant-Archive-Portability": "installation-bound"
      }
    });
  } catch (error) {
    return archiveErrorResponse(error, "Tenant backup kon niet worden gemaakt.", 403);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireGlobalArchiveAccess("restore");
    const { id } = await context.params;
    const globalTenantId = await mainTenantId();
    if (id === globalTenantId) {
      return NextResponse.json({ error: "Global tenant kan niet als klanttenant worden hersteld." }, { status: 400 });
    }
    const archive = await readArchiveUpload(request);
    await restoreTenantArchive({
      tenantId: id,
      archive,
      userId: user.id
    });
    return redirectToTenants(request);
  } catch (error) {
    return archiveErrorResponse(error, "Tenant restore is mislukt.");
  }
}
