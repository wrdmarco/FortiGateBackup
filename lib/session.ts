import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sessionCookieName } from "@/lib/session-cookie";

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await prisma.session.deleteMany({
    where: {
      OR: [{ userId }, { expires: { lt: new Date() } }]
    }
  });
  await prisma.session.create({ data: { userId, sessionToken: token, expires } });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires
  });
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
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
