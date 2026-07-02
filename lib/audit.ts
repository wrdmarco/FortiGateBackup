import { prisma } from "@/lib/db";

type AuditInput = {
  action: string;
  tenantId?: string | null;
  userId?: string | null;
  entity?: string;
  entityId?: string;
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
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...input.metadata, actorName: actor?.name ?? undefined, actorEmail: actor?.email ?? undefined }
      : input.metadata
        ? input.metadata
        : actor
          ? { actorName: actor.name, actorEmail: actor.email }
          : undefined;
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
