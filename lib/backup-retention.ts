import { BackupStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { stageBackupFiles } from "@/lib/backup-cleanup";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { tenantTransaction } from "@/lib/tenant-db";

export async function applyBackupRetention(fortigateId: string, tenantId: string) {
  const configured = Number(await getSetting("backup.retention.count", tenantId));
  const storedLimit = Number.isInteger(configured) ? Math.max(1, Math.min(configured, 10_000)) : 30;
  const eventLimit = Math.max(100, Math.min(storedLimit * 10, 2_000));
  const [stored, events] = await Promise.all([
    prisma.backup.findMany({
      where: { fortigateId, status: BackupStatus.CHANGED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: storedLimit,
      select: { id: true, filename: true, configArtifactId: true, sourceAnalysis: { select: { id: true } } }
    }),
    prisma.backup.findMany({
      where: { fortigateId, status: { in: [BackupStatus.UNCHANGED, BackupStatus.FAILED] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: eventLimit,
      select: { id: true, filename: true, configArtifactId: true, sourceAnalysis: { select: { id: true } } }
    })
  ]);
  const expired = [...stored, ...events].filter((backup)=>!backup.sourceAnalysis);
  if (!expired.length) return;

  const artifactIds=[...new Set(expired.flatMap((backup)=>backup.configArtifactId?[backup.configArtifactId]:[]))];
  const expiredIds=new Set(expired.map(({id})=>id));
  const artifacts=await tenantTransaction(tenantId,(tx)=>tx.configArtifact.findMany({where:{tenantId,id:{in:artifactIds}},select:{id:true,path:true,analysis:{select:{id:true}},backups:{select:{id:true}}}}));
  const orphans=artifacts.filter((artifact)=>!artifact.analysis&&artifact.backups.every((backup)=>expiredIds.has(backup.id)));
  const staged = await stageBackupFiles({ deviceIds: [], filenames: orphans.map(({ path }) => path) });
  try {
    await tenantTransaction(tenantId,async(tx)=>{await tx.backup.deleteMany({where:{tenantId,id:{in:[...expiredIds]}}});await tx.configArtifact.deleteMany({where:{tenantId,id:{in:orphans.map(({id})=>id)}}});});
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
