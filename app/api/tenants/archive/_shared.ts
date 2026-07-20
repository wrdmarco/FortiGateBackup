import { NextRequest, NextResponse } from "next/server";
import { assertPermission, requireTenantUser } from "@/lib/authz";
import type { PermissionKey } from "@/lib/rbac";
import { TENANT_ARCHIVE_MAX_UPLOAD_BYTES, TenantArchiveError } from "@/lib/tenant-archive";
import { mainTenantId } from "@/lib/tenant-main";

const MAX_MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024;
type GlobalArchiveOperation = "export" | "restore" | "switch";

const ARCHIVE_PERMISSION: Record<GlobalArchiveOperation, PermissionKey> = {
  export: "platform.tenants.export",
  restore: "platform.tenants.restore",
  switch: "platform.tenants.switch"
};

export async function requireGlobalArchiveAccess(operation: GlobalArchiveOperation) {
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    throw new TenantArchiveError("Geen toegang tot tenantarchieven.", 403, { cause: error });
  }
  const globalTenantId = await mainTenantId();
  if (!globalTenantId) {
    throw new TenantArchiveError("Global tenant is niet geconfigureerd.", 503);
  }
  assertGlobalArchiveContext(user, globalTenantId);
  try {
    await assertPermission(user, ARCHIVE_PERMISSION[operation]);
  } catch (error) {
    throw new TenantArchiveError("Geen toestemming voor deze tenantarchiefactie.", 403, { cause: error });
  }
  return { user, globalTenantId };
}

export function assertGlobalArchiveContext(
  user: { tenantId?: string | null; activeTenantId?: string | null },
  globalTenantId: string
) {
  const activeTenantId = user.activeTenantId ?? user.tenantId;
  if (user.tenantId !== globalTenantId || activeTenantId !== globalTenantId) {
    throw new TenantArchiveError("Tenantarchieven zijn alleen beschikbaar vanuit Global.", 403);
  }
}

export function archivePermission(operation: GlobalArchiveOperation) {
  return ARCHIVE_PERMISSION[operation];
}

export function redirectToTenants(request: NextRequest) {
  return NextResponse.redirect(new URL("/tenants", request.url), { status: 303 });
}

export async function readArchiveUpload(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) throw new TenantArchiveError("Upload vereist een bekende Content-Length.", 411);
  const bytes = Number(contentLength);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new TenantArchiveError("Ongeldige Content-Length.");
  if (bytes > TENANT_ARCHIVE_MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    throw new TenantArchiveError("Tenant backup zipbestand is te groot.", 413);
  }

  const formData = await request.formData();
  const file = formData.get("archive");
  if (!(file instanceof File)) throw new TenantArchiveError("Upload een tenant backup zipbestand.");
  if (file.size === 0) throw new TenantArchiveError("Het tenant backup zipbestand is leeg.");
  if (file.size > TENANT_ARCHIVE_MAX_UPLOAD_BYTES) throw new TenantArchiveError("Tenant backup zipbestand is te groot.", 413);
  return Buffer.from(await file.arrayBuffer());
}

export function archiveErrorResponse(error: unknown, fallback: string, fallbackStatus = 400) {
  const status = error instanceof TenantArchiveError ? error.status : fallbackStatus;
  const message = error instanceof TenantArchiveError ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
