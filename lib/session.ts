import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sessionCookieName, sessionCookieOptions, sessionExpiresAt, sessionRefreshThresholdMs } from "@/lib/session-cookie";

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = sessionExpiresAt();
  await prisma.session.deleteMany({
    where: {
      expires: { lt: new Date() }
    }
  });
  await prisma.session.create({ data: { userId, sessionToken: token, expires } });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, sessionCookieOptions(expires));
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) await prisma.session.deleteMany({ where: { sessionToken: token } });
  cookieStore.delete(sessionCookieName);
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
  if (session.expires.getTime() - Date.now() < sessionRefreshThresholdMs) {
    await prisma.session.update({
      where: { sessionToken: token },
      data: { expires: sessionExpiresAt() }
    });
  }
  return session.user;
}

export async function requireUser(options: { allowPasswordChange?: boolean } = {}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/change-password");
  return user;
}
