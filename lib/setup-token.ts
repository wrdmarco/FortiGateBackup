import crypto from "node:crypto";
import { prisma } from "@/lib/db";

export const setupTokenTtlMinutes = 30;
export const setupTokenCookieName = "fgbp_setup";

export function hashOneTimeToken(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function setupTokenCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: setupTokenTtlMinutes * 60
  };
}

export async function exchangeSetupToken(rawToken: string) {
  if (rawToken.length < 32 || rawToken.length > 256) return null;

  const now = new Date();
  const exchangedToken = crypto.randomBytes(32).toString("base64url");
  const currentHash = hashOneTimeToken(rawToken);
  const exchangedHash = hashOneTimeToken(exchangedToken);

  const candidate = await prisma.setupToken.findUnique({
    where: { tokenHash: currentHash },
    select: { id: true, usedAt: true, expires: true }
  });
  if (!candidate || candidate.usedAt || candidate.expires <= now) return null;

  const exchanged = await prisma.setupToken.updateMany({
    where: {
      id: candidate.id,
      tokenHash: currentHash,
      usedAt: null,
      expires: { gt: now }
    },
    data: { tokenHash: exchangedHash }
  });
  return exchanged.count === 1 ? exchangedToken : null;
}

export async function setupTokenIsValid(rawToken: string) {
  if (!rawToken) return false;
  const token = await prisma.setupToken.findUnique({
    where: { tokenHash: hashOneTimeToken(rawToken) },
    select: { expires: true, usedAt: true }
  });
  return Boolean(token && !token.usedAt && token.expires > new Date());
}
