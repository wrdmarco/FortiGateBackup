import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { setSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";

export async function POST(request: NextRequest) {
  const user = await requireTenantUser();
  const body = (await request.json()) as {
    tenantId?: string | null;
    key: string;
    value: string;
    encrypted?: boolean;
  };
  const tenantId = isSuperAdmin(user) ? user.activeTenantId ?? (await mainTenantId()) : user.tenantId;
  const setting = await setSetting(body.key, body.value, {
    tenantId,
    encrypted: body.encrypted ?? false
  });
  await auditLog({ action: "settings.updated", tenantId, userId: user.id });
  return NextResponse.json({
    id: setting.id,
    tenantId: setting.tenantId,
    key: setting.key,
    encrypted: setting.encrypted,
    updatedAt: setting.updatedAt
  });
}
