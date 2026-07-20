import crypto from "node:crypto";
import { AuthProvider } from "@prisma/client";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { auditLog } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";

export const entraProviderId = "microsoft-entra-id";
export const entraTransactionCookieName = "fgbp_entra_transaction";

const transactionIdentifierPrefix = "entra-login:";
const transactionMaxAgeSeconds = 10 * 60;
const throttleWindowMs = 15 * 60 * 1000;
const emailIpAttemptLimit = 10;
const ipAttemptLimit = 30;
const requiredSettingKeys = ["entra.enabled", "entra.tenantId", "entra.clientId", "entra.clientSecret"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EntraTransactionPayload = {
  version: 1;
  userId: string;
  tenantId: string;
  email: string;
};

export type EntraTenantConfiguration = {
  directoryTenantId: string;
  clientId: string;
  clientSecret: string;
};

export type EntraLoginTransaction = EntraTransactionPayload & {
  tokenHash: string;
  configuration: EntraTenantConfiguration | null;
};

export type StartedEntraLogin = EntraLoginTransaction & {
  cookieToken: string;
};

type SettingRow = {
  tenantId: string | null;
  key: string;
  value: string;
  encrypted: boolean;
  updatedAt: Date;
};

type AuditSubject = {
  userId?: string | null;
  tenantId?: string | null;
};

export function normalizeEntraEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidLoginEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function entraTransactionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: transactionMaxAgeSeconds,
    ...(expires ? { expires } : {})
  };
}

export async function hasAvailableEntraSso() {
  const activeTenants = await prisma.tenant.findMany({
    where: { active: true },
    select: { id: true }
  });
  if (!activeTenants.length) return false;

  const tenantIds = activeTenants.map(({ id }) => id);
  const settings = await prisma.systemSetting.findMany({
    where: {
      tenantId: { in: tenantIds },
      key: { in: [...requiredSettingKeys] }
    },
    orderBy: { updatedAt: "desc" },
    select: { tenantId: true, key: true, value: true, encrypted: true, updatedAt: true }
  });

  const settingsByTenant = new Map<string, SettingRow[]>();
  for (const setting of settings) {
    if (!setting.tenantId) continue;
    const entries = settingsByTenant.get(setting.tenantId) ?? [];
    entries.push(setting);
    settingsByTenant.set(setting.tenantId, entries);
  }

  for (const tenantId of tenantIds) {
    if (configurationFromSettings(settingsByTenant.get(tenantId) ?? [])) return true;
  }
  return false;
}

export async function loadEntraTenantConfiguration(tenantId: string | null | undefined) {
  const settings = await prisma.systemSetting.findMany({
    where: {
      tenantId: tenantId ?? "__no_entra_tenant__",
      key: { in: [...requiredSettingKeys] }
    },
    orderBy: { updatedAt: "desc" },
    select: { tenantId: true, key: true, value: true, encrypted: true, updatedAt: true }
  });
  return configurationFromSettings(settings);
}

export async function checkEntraStartThrottle(email: string, ipAddress: string | null) {
  const normalizedIp = ipAddress?.trim().slice(0, 128) || null;
  const keys = normalizedIp
    ? [
        { key: throttleKey("email-ip", `${email}|${normalizedIp}`), limit: emailIpAttemptLimit },
        { key: throttleKey("ip", normalizedIp), limit: ipAttemptLimit }
      ]
    : [{ key: throttleKey("email", email), limit: emailIpAttemptLimit }];
  const now = new Date();
  const windowStart = new Date(now.getTime() - throttleWindowMs);
  const lockedUntil = new Date(now.getTime() + throttleWindowMs);

  return prisma.$transaction(async (tx) => {
    let denied = false;
    for (const entry of keys) {
      const current = await tx.loginThrottle.findUnique({ where: { key: entry.key } });
      if (current?.lockedUntil && current.lockedUntil > now) {
        denied = true;
        continue;
      }
      if (!current) {
        await tx.loginThrottle.create({ data: { key: entry.key, failures: 1 } });
        continue;
      }
      if (current.updatedAt < windowStart) {
        await tx.loginThrottle.update({
          where: { key: entry.key },
          data: { failures: 1, lockedUntil: null }
        });
        continue;
      }

      const failures = current.failures + 1;
      const shouldLock = failures > entry.limit;
      await tx.loginThrottle.update({
        where: { key: entry.key },
        data: { failures, lockedUntil: shouldLock ? lockedUntil : null }
      });
      denied ||= shouldLock;
    }
    return !denied;
  });
}

export async function startEntraLogin(emailInput: unknown): Promise<StartedEntraLogin | null> {
  const email = normalizeEntraEmail(emailInput);
  const user = isValidLoginEmail(email)
    ? await prisma.user.findUnique({
        where: { email },
        include: { tenant: { select: { id: true, active: true } } }
      })
    : null;
  const configuration = await loadEntraTenantConfiguration(user?.tenantId);
  if (!user?.active || !user.tenantId || !user.tenant?.active || !configuration) {
    await recordEntraLoginFailure(
      { userId: user?.id, tenantId: user?.tenantId },
      "login_not_available",
      "initiation"
    );
    return null;
  }

  const cookieToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashTransactionToken(cookieToken);
  const expires = new Date(Date.now() + transactionMaxAgeSeconds * 1000);
  const payload: EntraTransactionPayload = {
    version: 1,
    userId: user.id,
    tenantId: user.tenantId,
    email
  };

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({
      where: {
        identifier: { startsWith: transactionIdentifierPrefix },
        expires: { lt: new Date() }
      }
    }),
    prisma.verificationToken.create({
      data: {
        identifier: encodeTransactionPayload(payload),
        token: tokenHash,
        expires
      }
    })
  ]);

  return { ...payload, tokenHash, cookieToken, configuration };
}

export async function setEntraTransactionCookie(cookieToken: string) {
  const cookieStore = await cookies();
  cookieStore.set(
    entraTransactionCookieName,
    cookieToken,
    entraTransactionCookieOptions(new Date(Date.now() + transactionMaxAgeSeconds * 1000))
  );
}

export async function clearEntraTransactionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(entraTransactionCookieName, "", {
    ...entraTransactionCookieOptions(new Date(0)),
    maxAge: 0
  });
}

export function expireEntraTransactionCookie(response: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${entraTransactionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
  );
  return response;
}

export async function readEntraLoginTransaction(request?: NextRequest): Promise<EntraLoginTransaction | null> {
  const cookieToken = request
    ? request.cookies.get(entraTransactionCookieName)?.value
    : (await cookies()).get(entraTransactionCookieName)?.value;
  if (!cookieToken || cookieToken.length > 128) return null;

  const tokenHash = hashTransactionToken(cookieToken);
  const stored = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });
  if (!stored) return null;
  const payload = decodeTransactionPayload(stored.identifier);
  if (!payload) {
    await prisma.verificationToken.deleteMany({ where: { token: tokenHash } });
    return null;
  }
  if (stored.expires <= new Date()) {
    const deleted = await prisma.verificationToken.deleteMany({ where: { token: tokenHash } });
    if (deleted.count) {
      await recordEntraLoginFailure(payload, "transaction_expired", "callback");
    }
    return null;
  }

  const configuration = await loadEntraTenantConfiguration(payload.tenantId);
  return { ...payload, tokenHash, configuration };
}

export async function completeEntraLogin(
  transaction: EntraLoginTransaction,
  profileEmail: unknown,
  profileTenantId: unknown
) {
  const email = normalizeEntraEmail(profileEmail);
  const directoryTenantId = String(profileTenantId ?? "").trim().toLowerCase();

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const consumed = await tx.verificationToken.deleteMany({
        where: { token: transaction.tokenHash, expires: { gt: new Date() } }
      });
      if (consumed.count !== 1) {
        return { ok: false as const, reason: "transaction_invalid", subject: transaction };
      }

      const user = await tx.user.findUnique({
        where: { id: transaction.userId },
        include: { tenant: { select: { id: true, active: true } } }
      });
      const configuration = transaction.configuration;
      const identityMatches =
        isValidLoginEmail(email) &&
        email === transaction.email &&
        normalizeEntraEmail(user?.email) === transaction.email;
      const tenantMatches =
        Boolean(configuration) &&
        directoryTenantId === configuration?.directoryTenantId.toLowerCase() &&
        user?.tenantId === transaction.tenantId &&
        user?.tenant?.id === transaction.tenantId;
      if (!user?.active || !user.tenant?.active || !identityMatches || !tenantMatches) {
        return {
          ok: false as const,
          reason: "identity_mismatch",
          subject: { userId: user?.id ?? transaction.userId, tenantId: transaction.tenantId }
        };
      }

      if (!user.passwordHash && user.provider !== AuthProvider.ENTRA) {
        await tx.user.update({
          where: { id: user.id },
          data: { provider: AuthProvider.ENTRA }
        });
      }
      return { ok: true as const, userId: user.id, tenantId: user.tenantId };
    });

    if (!outcome.ok) {
      await recordEntraLoginFailure(outcome.subject, outcome.reason, "callback");
      return false;
    }

    try {
      await createSession(outcome.userId);
    } catch {
      await recordEntraLoginFailure(
        { userId: outcome.userId, tenantId: outcome.tenantId },
        "session_creation_failed",
        "callback"
      );
      return false;
    }

    try {
      await auditLog({
        action: "auth.login",
        tenantId: outcome.tenantId,
        userId: outcome.userId,
        entity: "User",
        entityId: outcome.userId,
        metadata: { provider: "entra" }
      });
    } catch {
      await destroySession().catch(() => undefined);
      return false;
    }
    return true;
  } catch {
    await prisma.verificationToken.deleteMany({ where: { token: transaction.tokenHash } }).catch(() => undefined);
    await recordEntraLoginFailure(transaction, "callback_failed", "callback");
    return false;
  }
}

export async function failOutstandingEntraLogin(request: NextRequest, reason = "oauth_callback_failed") {
  const transaction = await readEntraLoginTransaction(request);
  if (!transaction) return;
  const consumed = await prisma.verificationToken.deleteMany({ where: { token: transaction.tokenHash } });
  if (consumed.count) await recordEntraLoginFailure(transaction, reason, "callback");
}

export async function cancelEntraLogin(transaction: EntraLoginTransaction, reason: string, stage = "initiation") {
  const consumed = await prisma.verificationToken.deleteMany({ where: { token: transaction.tokenHash } });
  if (consumed.count) await recordEntraLoginFailure(transaction, reason, stage);
}

export async function recordGenericEntraFailure(reason: string, stage: string) {
  await recordEntraLoginFailure({}, reason, stage);
}

function configurationFromSettings(settings: SettingRow[]): EntraTenantConfiguration | null {
  const latest = new Map<string, SettingRow>();
  for (const setting of settings) {
    if (!latest.has(setting.key)) latest.set(setting.key, setting);
  }
  if (latest.get("entra.enabled")?.value.trim().toLowerCase() !== "true") return null;

  const directoryTenantId = latest.get("entra.tenantId")?.value.trim() ?? "";
  const clientId = latest.get("entra.clientId")?.value.trim() ?? "";
  const clientSecretSetting = latest.get("entra.clientSecret");
  if (!uuidPattern.test(directoryTenantId) || !uuidPattern.test(clientId) || !clientSecretSetting?.encrypted) return null;

  try {
    const clientSecret = decryptSecret(clientSecretSetting.value);
    if (clientSecret.length < 16) return null;
    return { directoryTenantId, clientId, clientSecret };
  } catch {
    return null;
  }
}

function throttleKey(scope: string, value: string) {
  const digest = crypto.createHash("sha256").update(value, "utf8").digest("hex");
  return `entra:${scope}:${digest}`;
}

function hashTransactionToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function encodeTransactionPayload(payload: EntraTransactionPayload) {
  return `${transactionIdentifierPrefix}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function decodeTransactionPayload(identifier: string): EntraTransactionPayload | null {
  if (!identifier.startsWith(transactionIdentifierPrefix)) return null;
  try {
    const encoded = identifier.slice(transactionIdentifierPrefix.length);
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<EntraTransactionPayload>;
    if (
      value.version !== 1 ||
      typeof value.userId !== "string" ||
      !value.userId ||
      typeof value.tenantId !== "string" ||
      !value.tenantId ||
      typeof value.email !== "string" ||
      !isValidLoginEmail(value.email)
    ) {
      return null;
    }
    return { version: 1, userId: value.userId, tenantId: value.tenantId, email: normalizeEntraEmail(value.email) };
  } catch {
    return null;
  }
}

async function recordEntraLoginFailure(subject: AuditSubject, reason: string, stage: string) {
  await safeAudit({
    action: "auth.login.failed",
    tenantId: subject.tenantId,
    userId: subject.userId,
    entity: subject.userId ? "User" : undefined,
    entityId: subject.userId ?? undefined,
    outcome: "failure",
    reason,
    metadata: { provider: "entra", stage }
  });
}

async function safeAudit(input: Parameters<typeof auditLog>[0]) {
  try {
    await auditLog(input);
  } catch {
    // Failure responses remain generic even when the audit sink is unavailable.
  }
}
