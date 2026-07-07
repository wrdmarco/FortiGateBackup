import { prisma } from "@/lib/db";

type AuditInput = {
  action: string;
  tenantId?: string | null;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  outcome?: "success" | "failure" | "denied";
  reason?: string;
  metadata?: unknown;
  ipAddress?: string | null;
};

export async function auditLog(input: AuditInput) {
  const actor = input.userId
    ? await prisma.user.findUnique({
        where: { id: input.userId },
        select: { name: true, email: true }
      })
    : null;
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
  await prisma.auditLog.create({
    data: {
      action: input.action,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      ipAddress: input.ipAddress ?? null
    }
  });
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
