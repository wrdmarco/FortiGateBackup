import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createBreakGlassSettingsSession } from "@/lib/session";
import { mainTenantId } from "@/lib/tenant-main";

const identifier = "break-glass:global-settings";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hashedToken = hashToken(token);
  const now = new Date();
  const stored = await prisma.verificationToken.findFirst({
    where: {
      identifier,
      token: hashedToken,
      expires: { gt: now }
    }
  });

  await prisma.verificationToken.deleteMany({
    where: {
      OR: [
        { identifier, token: hashedToken },
        { identifier, expires: { lte: now } }
      ]
    }
  });

  if (!stored) {
    return NextResponse.redirect(new URL("/login?error=break-glass-expired", _request.url));
  }

  const globalTenantId = await mainTenantId();
  const user = await prisma.user.findFirst({
    where: {
      role: UserRole.SUPER_ADMIN,
      active: true,
      tenantId: globalTenantId
    },
    orderBy: { createdAt: "asc" }
  });
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=break-glass-no-super-admin", _request.url));
  }

  await createBreakGlassSettingsSession(user.id);
  await auditLog({
    action: "break_glass.settings_login",
    tenantId: globalTenantId,
    userId: user.id,
    entity: "System",
    metadata: { scope: "global_settings", expiresMinutes: 15 }
  });
  return NextResponse.redirect(new URL("/settings?tab=sso", _request.url));
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
