import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { setSetting } from "@/lib/settings";

export async function POST(request: NextRequest) {
  const user = await requireTenantUser();
  const body = (await request.json()) as {
    tenantId?: string | null;
    key: string;
    value: string;
    encrypted?: boolean;
  };
  const tenantId = isSuperAdmin(user) ? body.tenantId ?? null : user.tenantId;
  const setting = await setSetting(body.key, body.value, {
    tenantId,
    encrypted: body.encrypted ?? false
  });
  await auditLog({ action: "settings.updated", tenantId, userId: user.id });
  return NextResponse.json(setting);
}
