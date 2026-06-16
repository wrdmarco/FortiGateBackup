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
  await prisma.auditLog.create({
    data: {
      action: input.action,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      ipAddress: input.ipAddress ?? null
    }
  });
}
