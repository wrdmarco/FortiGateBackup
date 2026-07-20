import { BackupStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { stageBackupFiles } from "@/lib/backup-cleanup";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export async function applyBackupRetention(fortigateId: string, tenantId: string) {
  const configured = Number(await getSetting("backup.retention.count", tenantId));
  const storedLimit = Number.isInteger(configured) ? Math.max(1, Math.min(configured, 10_000)) : 30;
  const eventLimit = Math.max(100, Math.min(storedLimit * 10, 2_000));
  const [stored, events] = await Promise.all([
    prisma.backup.findMany({
      where: { fortigateId, status: BackupStatus.CHANGED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: storedLimit,
      select: { id: true, filename: true }
    }),
    prisma.backup.findMany({
      where: { fortigateId, status: { in: [BackupStatus.UNCHANGED, BackupStatus.FAILED] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: eventLimit,
      select: { id: true, filename: true }
    })
  ]);
  const expired = [...stored, ...events];
  if (!expired.length) return;

  const staged = await stageBackupFiles({ deviceIds: [], filenames: expired.map(({ filename }) => filename) });
  try {
    await prisma.backup.deleteMany({ where: { id: { in: expired.map(({ id }) => id) } } });
  } catch (error) {
    await staged.rollback();
    throw error;
  }
  await staged.commit().catch(() => undefined);
  await auditLog({
    action: "backup.retention.applied",
    tenantId,
    entity: "FortiGate",
    entityId: fortigateId,
    metadata: { removedStoredBackups: stored.length, removedEventRecords: events.length, storedLimit, eventLimit }
  });
}
