import { BackupJobStatus, BackupJobTrigger, BackupStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { notifyBackupResult } from "@/lib/backup-notifications";
import { prisma } from "@/lib/db";
import { BackupAlreadyRunningError, runBackup } from "@/lib/fortigate";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";
import { randomUUID } from "node:crypto";

const staleJobMs = 30 * 60 * 1000;
const DEFAULT_BACKUP_CONCURRENCY = 2;
const MAXIMUM_BACKUP_CONCURRENCY = 4;
const BACKUP_WORKER_ID = `backup-${process.pid}-${randomUUID()}`;
let processing: Promise<void> | null = null;

export function backupConcurrencyFromSetting(value: string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_BACKUP_CONCURRENCY;
  return Math.min(parsed, MAXIMUM_BACKUP_CONCURRENCY);
}

export async function enqueueManualBackup(input: { fortigateId: string; tenantId: string; userId: string }) {
  return enqueueBackupJob({
    fortigateId: input.fortigateId,
    tenantId: input.tenantId,
    requestedByUserId: input.userId,
    trigger: BackupJobTrigger.MANUAL
  });
}

export async function enqueueScheduledBackup(input: { fortigateId: string; tenantId: string }) {
  return enqueueBackupJob({
    fortigateId: input.fortigateId,
    tenantId: input.tenantId,
    requestedByUserId: null,
    trigger: BackupJobTrigger.SCHEDULED
  });
}

async function enqueueBackupJob(input: {
  fortigateId: string;
  tenantId: string;
  requestedByUserId: string | null;
  trigger: BackupJobTrigger;
}) {
  await recoverStaleBackupJobs(input.fortigateId);
  const existing = await prisma.backupJob.findFirst({
    where: { fortigateId: input.fortigateId, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING] } },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return { job: existing, created: false };

  try {
    const job = await prisma.backupJob.create({
      data: {
        fortigateId: input.fortigateId,
        tenantId: input.tenantId,
        requestedByUserId: input.requestedByUserId,
        trigger: input.trigger
      }
    });
    return { job, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const job = await prisma.backupJob.findFirstOrThrow({
      where: { fortigateId: input.fortigateId, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING] } },
      orderBy: { createdAt: "asc" }
    });
    return { job, created: false };
  }
}

export function processBackupJobs() {
  if (processing) return processing;
  const run = processBackupJobsInternal().finally(() => {
    if (processing === run) processing = null;
  });
  processing = run;
  return run;
}

async function processBackupJobsInternal() {
  const now = new Date();
  await recoverStaleBackupJobs();
  await prisma.backupJob.deleteMany({
    where: {
      status: { in: [BackupJobStatus.COMPLETED, BackupJobStatus.FAILED] },
      finishedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
    }
  });

  const globalTenantId = await mainTenantId();
  const maximum = backupConcurrencyFromSetting(await getSetting("scheduler.maxParallelJobs", globalTenantId));
  const claimed = await prisma.$transaction((tx)=>tx.$queryRaw<Array<{id:string;fortigateId:string;tenantId:string;requestedByUserId:string|null;attempts:number}>>`WITH candidates AS (SELECT id FROM "BackupJob" WHERE status='PENDING' AND "availableAt"<=now() ORDER BY "availableAt","createdAt" FOR UPDATE SKIP LOCKED LIMIT ${maximum}) UPDATE "BackupJob" j SET status='RUNNING',"startedAt"=now(),attempts=attempts+1,error=NULL,"workerId"=${BACKUP_WORKER_ID},"leaseExpiresAt"=now()+interval '30 minutes',"heartbeatAt"=now(),"updatedAt"=now() FROM candidates WHERE j.id=candidates.id RETURNING j.id,j."fortigateId",j."tenantId",j."requestedByUserId",j.attempts`);
  await Promise.all(claimed.map(executeBackupJob));
}

export async function recoverStaleBackupJobs(fortigateId?: string) {
  const staleBefore = new Date(Date.now() - staleJobMs);
  const stale = await prisma.backupJob.findMany({
    where: {
      ...(fortigateId ? { fortigateId } : {}),
      status: BackupJobStatus.RUNNING,
      OR: [
        { leaseExpiresAt: { lt: new Date() } },
        { leaseExpiresAt: null },
        { heartbeatAt: { lt: staleBefore } },
        { workerId: null }
      ]
    },
    select: { id: true, tenantId: true, fortigateId: true, requestedByUserId: true, attempts: true }
  });
  for (const job of stale) {
    const retryCount = configuredRetryCount(await getSetting("backup.retry.count", job.tenantId));
    if (job.attempts > retryCount) {
      await finishFailed(job, "Workerlease verlopen nadat alle ingestelde pogingen waren verbruikt.");
      continue;
    }
    await prisma.backupJob.updateMany({
      where: { id: job.id, status: BackupJobStatus.RUNNING },
      data: { status: BackupJobStatus.PENDING, startedAt: null, workerId: null, leaseExpiresAt: null, heartbeatAt: null, availableAt: new Date(), error: "Workerlease verlopen; job veilig opnieuw ingepland." }
    });
  }
}

async function executeBackupJob(job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number }) {
  const heartbeat=setInterval(()=>void prisma.backupJob.updateMany({where:{id:job.id,status:BackupJobStatus.RUNNING,workerId:BACKUP_WORKER_ID},data:{heartbeatAt:new Date(),leaseExpiresAt:new Date(Date.now()+staleJobMs)}}).catch(()=>undefined),60_000);heartbeat.unref();
  try {
  const device = await prisma.fortiGate.findUnique({
    where: { id: job.fortigateId },
    select: { active: true, customer: { select: { active: true, tenant: { select: { active: true } } } } }
  });
  if (!device?.active || !device.customer.active || !device.customer.tenant.active) {
    await finishFailed(job, "FortiGate, klant of tenant is niet actief.");
    return;
  }

  try {
    const result = await runBackup(job.fortigateId, { notifyResult: false });
    if (result.status === BackupStatus.FAILED) {
      await retryOrFail(job, result.error || "Backup is mislukt.", result.id);
      return;
    }
    await prisma.backupJob.update({
      where: { id: job.id },
      data: { status: BackupJobStatus.COMPLETED, finishedAt: new Date(), error: null, workerId: null, leaseExpiresAt: null }
    });
    await auditLog({
      action: "backup.job.completed",
      tenantId: job.tenantId,
      userId: job.requestedByUserId,
      entity: "BackupJob",
      entityId: job.id,
      metadata: { fortigateId: job.fortigateId, backupId: result.id, attempts: job.attempts }
    });
    await notifyFinalResult(job, result.id);
  } catch (error) {
    if (error instanceof BackupAlreadyRunningError) {
      await prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: BackupJobStatus.PENDING,
          startedAt: null,
          workerId: null,
          leaseExpiresAt: null,
          attempts: { decrement: 1 },
          availableAt: new Date(Date.now() + 30_000),
          error: "Een andere backup draait; job opnieuw ingepland."
        }
      });
      return;
    }
    await retryOrFail(job, error instanceof Error ? error.message : "Onbekende backupfout.");
  }
  } finally { clearInterval(heartbeat); }
}

async function retryOrFail(
  job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number },
  error: string,
  backupId?: string
) {
  const retryCount = configuredRetryCount(await getSetting("backup.retry.count", job.tenantId));
  if (job.attempts <= retryCount) {
    const delayMs = Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 15 * 60_000);
    await prisma.backupJob.update({
      where: { id: job.id },
      data: { status: BackupJobStatus.PENDING, startedAt: null, workerId: null, leaseExpiresAt: null, availableAt: new Date(Date.now() + delayMs), error }
    });
    return;
  }
  await finishFailed(job, error, backupId);
}

export function configuredRetryCount(value:string|null|undefined){
  const parsed=Number(value);
  return Number.isInteger(parsed)?Math.max(0,Math.min(parsed,10)):0;
}

async function finishFailed(
  job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number },
  error: string,
  backupId?: string
) {
  await prisma.backupJob.update({
    where: { id: job.id },
    data: { status: BackupJobStatus.FAILED, finishedAt: new Date(), error, workerId: null, leaseExpiresAt: null }
  });
  await auditLog({
    action: "backup.job.failed",
    tenantId: job.tenantId,
    userId: job.requestedByUserId,
    entity: "BackupJob",
    entityId: job.id,
    outcome: "failure",
    reason: error,
    metadata: { fortigateId: job.fortigateId, attempts: job.attempts }
  });
  if (backupId) await notifyFinalResult(job, backupId);
}

async function notifyFinalResult(job: { id: string; fortigateId: string; tenantId: string }, backupId: string) {
  try {
    await notifyBackupResult(backupId);
  } catch (error) {
    await auditLog({
      action: "backup.notification_dispatch_failed",
      tenantId: job.tenantId,
      entity: "BackupJob",
      entityId: job.id,
      outcome: "failure",
      reason: error instanceof Error ? error.message : "Onbekende notificatiefout.",
      metadata: { fortigateId: job.fortigateId, backupId }
    });
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
