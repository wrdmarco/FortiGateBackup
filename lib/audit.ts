import crypto from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

type AuditInput = {
  action: string;
  tenantId?: string | null;
  tenantName?: string | null;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  outcome?: "success" | "failure" | "denied";
  reason?: string;
  metadata?: unknown;
  ipAddress?: string | null;
  requestId?: string | null;
};

export async function auditLog(input: AuditInput) {
  const [actor, tenant, requestContext] = await Promise.all([
    input.userId
      ? prisma.user.findUnique({
          where: { id: input.userId },
          select: { name: true, email: true }
        })
      : null,
    input.tenantId
      ? prisma.tenant.findUnique({
          where: { id: input.tenantId },
          select: { name: true }
        })
      : null,
    readRequestContext()
  ]);
  const outcome = input.outcome ?? inferOutcome(input.action);
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? redactAuditMetadata({
          auditSchemaVersion: 1,
          outcome,
          reason: input.reason,
          target: input.entity ? { type: input.entity, id: input.entityId ?? null } : undefined,
          ...input.metadata,
          actorType: input.userId ? "user" : "system",
          actorName: actor?.name ?? undefined,
          actorEmail: actor?.email ?? undefined
        })
      : input.metadata
        ? redactAuditMetadata({
            auditSchemaVersion: 1,
            outcome,
            reason: input.reason,
            value: input.metadata,
            actorType: input.userId ? "user" : "system",
            actorName: actor?.name ?? undefined,
            actorEmail: actor?.email ?? undefined
          })
        : redactAuditMetadata({
            auditSchemaVersion: 1,
            outcome,
            reason: input.reason,
            target: input.entity ? { type: input.entity, id: input.entityId ?? null } : undefined,
            actorType: input.userId ? "user" : "system",
            actorName: actor?.name ?? undefined,
            actorEmail: actor?.email ?? undefined
          });
  const createdAt = new Date();
  const id = crypto.randomUUID();
  const requestId = input.requestId ?? requestContext.requestId ?? crypto.randomUUID();
  const ipAddress = input.ipAddress ?? requestContext.ipAddress ?? null;
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  await prisma.$transaction(async (tx) => {
    const previous = await tx.auditLog.findFirst({
      where: { tenantId: input.tenantId ?? null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { integrityHash: true }
    });
    const previousHash = previous?.integrityHash ?? null;
    const integrityHash = signAuditEntry({
      id,
      tenantId: input.tenantId ?? null,
      tenantName: input.tenantName ?? tenant?.name ?? null,
      userId: input.userId ?? null,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      action: input.action,
      outcome,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      metadata: metadataJson,
      ipAddress,
      requestId,
      createdAt: createdAt.toISOString(),
      previousHash
    });

    await tx.auditLog.create({
      data: {
        id,
        action: input.action,
        outcome,
        tenantId: input.tenantId ?? null,
        tenantName: input.tenantName ?? tenant?.name ?? null,
        userId: input.userId ?? null,
        actorId: input.userId ?? null,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        entity: input.entity,
        entityId: input.entityId,
        metadata: metadataJson,
        ipAddress,
        requestId,
        previousHash,
        integrityHash,
        createdAt
      }
    });
  });
}

export async function verifyAuditTrail(tenantId: string | null) {
  const entries = await prisma.auditLog.findMany({
    where: { tenantId, integrityHash: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  let previousHash: string | null = null;
  for (const entry of entries) {
    if (entry.previousHash !== previousHash) return { valid: false, checked: entries.length, invalidEntryId: entry.id };
    const expected = signAuditEntry({
      id: entry.id,
      tenantId: entry.tenantId,
      tenantName: entry.tenantName,
      userId: entry.actorId ?? entry.userId,
      actorName: entry.actorName,
      actorEmail: entry.actorEmail,
      action: entry.action,
      outcome: entry.outcome,
      entity: entry.entity,
      entityId: entry.entityId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      requestId: entry.requestId,
      createdAt: entry.createdAt.toISOString(),
      previousHash: entry.previousHash
    });
    if (!safeHashEqual(expected, entry.integrityHash!)) {
      return { valid: false, checked: entries.length, invalidEntryId: entry.id };
    }
    previousHash = entry.integrityHash!;
  }
  return { valid: true, checked: entries.length, invalidEntryId: null };
}

async function readRequestContext() {
  try {
    const requestHeaders = await headers();
    return {
      requestId: requestHeaders.get("x-request-id") ?? requestHeaders.get("x-correlation-id"),
      ipAddress:
        requestHeaders
          .get("x-forwarded-for")
          ?.split(",")[0]
          ?.trim() ?? requestHeaders.get("x-real-ip")
    };
  } catch {
    return { requestId: null, ipAddress: null };
  }
}

function signAuditEntry(entry: Record<string, unknown>) {
  return crypto
    .createHmac("sha256", getEnv().ENCRYPTION_KEY)
    .update(JSON.stringify(entry), "utf8")
    .digest("hex");
}

function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function inferOutcome(action: string): "success" | "failure" | "denied" {
  if (action.includes("denied")) return "denied";
  if (action.includes("failed") || action.includes("failure")) return "failure";
  return "success";
}

function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitiveAuditKey(key) ? "[REDACTED]" : redactAuditMetadata(entry)
    ])
  );
}

function isSensitiveAuditKey(key: string) {
  return /password|token|secret|apikey|api_key|cookie|authorization|credential/i.test(key);
}
