import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createBreakGlassSettingsSession } from "@/lib/session";
import { hashOneTimeToken } from "@/lib/setup-token";
import { mainTenantId } from "@/lib/tenant-main";

const identifierPrefix = "break-glass:global-settings:";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const rawToken = typeof body?.token === "string" ? body.token : "";
  if (rawToken.length < 32 || rawToken.length > 256) return invalidResponse();

  const now = new Date();
  const stored = await prisma.$transaction(async (tx) => {
    const candidate = await tx.verificationToken.findUnique({
      where: { token: hashOneTimeToken(rawToken) }
    });
    if (!candidate || !candidate.identifier.startsWith(identifierPrefix) || candidate.expires <= now) return null;
    const consumed = await tx.verificationToken.deleteMany({
      where: { identifier: candidate.identifier, token: candidate.token, expires: { gt: now } }
    });
    return consumed.count === 1 ? candidate : null;
  });

  await prisma.verificationToken.deleteMany({ where: { expires: { lte: now } } });
  if (!stored) return invalidResponse();

  const userId = stored.identifier.slice(identifierPrefix.length);
  const globalTenantId = await mainTenantId();
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "SUPER_ADMIN", active: true, tenantId: globalTenantId }
  });
  if (!user) return invalidResponse();

  await createBreakGlassSettingsSession(user.id);
  await auditLog({
    action: "break_glass.settings_login",
    tenantId: globalTenantId,
    userId: user.id,
    entity: "System",
    metadata: { scope: "global_settings", expiresMinutes: 15 }
  });
  return NextResponse.json({ redirectTo: "/settings?tab=sso" });
}

function invalidResponse() {
  return NextResponse.json({ error: "Deze eenmalige link is ongeldig of verlopen." }, { status: 401 });
}
