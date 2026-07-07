import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  breakGlassCookieName,
  breakGlassCookieOptions,
  breakGlassMaxAgeSeconds,
  sessionCookieName,
  sessionCookieOptions,
  sessionExpiresAt,
  sessionRefreshThresholdMs
} from "@/lib/session-cookie";
import { mainTenantId } from "@/lib/tenant-main";

async function defaultActiveTenantId(user: { role: UserRole; tenantId: string | null }) {
  if (user.role === UserRole.SUPER_ADMIN) return (await mainTenantId()) ?? user.tenantId;
  return user.tenantId;
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = sessionExpiresAt();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, tenantId: true }
  });
  const activeTenantId = await defaultActiveTenantId(user);
  await prisma.session.deleteMany({
    where: {
      expires: { lt: new Date() }
    }
  });
  await prisma.session.create({ data: { userId, sessionToken: token, activeTenantId, expires } });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, sessionCookieOptions(expires));
}

export async function createBreakGlassSettingsSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + breakGlassMaxAgeSeconds * 1000);
  const activeTenantId = await mainTenantId();
  await prisma.session.create({
    data: {
      userId,
      sessionToken: token,
      activeTenantId,
      breakGlassSettingsOnly: true,
      expires
    }
  });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, sessionCookieOptions(expires));
  cookieStore.set(breakGlassCookieName, "1", breakGlassCookieOptions(expires));
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) await prisma.session.deleteMany({ where: { sessionToken: token } });
  cookieStore.delete(sessionCookieName);
  cookieStore.delete(breakGlassCookieName);
}

export async function currentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: { include: { tenant: true } } }
  });
  if (!session || session.expires < new Date() || !session.user.active) return null;
  if (session.user.role !== UserRole.SUPER_ADMIN && !session.user.tenant?.active) return null;
  const fallbackActiveTenantId = await defaultActiveTenantId(session.user);
  const requestedActiveTenantId = session.user.role === UserRole.SUPER_ADMIN ? session.activeTenantId ?? fallbackActiveTenantId : fallbackActiveTenantId;
  const activeTenant = requestedActiveTenantId
    ? await prisma.tenant.findFirst({
        where: { id: requestedActiveTenantId, active: true },
        select: { id: true, name: true, slug: true, active: true }
      })
    : null;
  const activeTenantId = activeTenant?.id ?? fallbackActiveTenantId ?? null;
  if (activeTenantId !== session.activeTenantId) {
    await prisma.session.update({
      where: { sessionToken: token },
      data: { activeTenantId }
    });
  }
  if (session.expires.getTime() - Date.now() < sessionRefreshThresholdMs) {
    await prisma.session.update({
      where: { sessionToken: token },
      data: { expires: sessionExpiresAt() }
    });
  }
  return { ...session.user, activeTenantId, activeTenant, breakGlassSettingsOnly: session.breakGlassSettingsOnly };
}

export async function requireUser(options: { allowPasswordChange?: boolean; allowBreakGlassSettingsOnly?: boolean } = {}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/change-password");
  if (user.breakGlassSettingsOnly && !options.allowBreakGlassSettingsOnly) redirect("/settings?tab=sso");
  return user;
}

export async function setActiveTenantContext(tenantId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) redirect("/login");
  await prisma.session.update({
    where: { sessionToken: token },
    data: { activeTenantId: tenantId }
  });
}
