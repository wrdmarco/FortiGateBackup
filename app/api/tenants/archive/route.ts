import { NextRequest, NextResponse } from "next/server";
import { restoreTenantArchive, tenantIdFromArchive } from "@/lib/tenant-archive";
import {
  archiveErrorResponse,
  readArchiveUpload,
  redirectToTenants,
  requireGlobalArchiveAccess
} from "@/app/api/tenants/archive/_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { user, globalTenantId } = await requireGlobalArchiveAccess("restore");
    const archive = await readArchiveUpload(request);
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
    return redirectToTenants(request);
  } catch (error) {
    return archiveErrorResponse(error, "Tenant restore is mislukt.");
  }
}
