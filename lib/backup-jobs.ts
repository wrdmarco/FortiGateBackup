import { BackupJobStatus, BackupJobTrigger, BackupStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { notifyBackupResult } from "@/lib/backup-notifications";
import { prisma } from "@/lib/db";
import { BackupAlreadyRunningError, runBackup } from "@/lib/fortigate";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";

const staleJobMs = 30 * 60 * 1000;
const DEFAULT_BACKUP_CONCURRENCY = 2;
const MAXIMUM_BACKUP_CONCURRENCY = 4;
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
  await prisma.backupJob.updateMany({
    where: { status: BackupJobStatus.RUNNING, startedAt: { lt: new Date(now.getTime() - staleJobMs) } },
    data: { status: BackupJobStatus.PENDING, startedAt: null, availableAt: now, error: "Worker is opnieuw gestart; job opnieuw ingepland." }
  });
  await prisma.backupJob.deleteMany({
    where: {
      status: { in: [BackupJobStatus.COMPLETED, BackupJobStatus.FAILED] },
      finishedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
    }
  });

  const globalTenantId = await mainTenantId();
  const maximum = backupConcurrencyFromSetting(await getSetting("scheduler.maxParallelJobs", globalTenantId));
  const candidates = await prisma.backupJob.findMany({
    where: { status: BackupJobStatus.PENDING, availableAt: { lte: now } },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: maximum
  });
  const claimed = [];
  for (const candidate of candidates) {
    const claim = await prisma.backupJob.updateMany({
      where: { id: candidate.id, status: BackupJobStatus.PENDING, availableAt: { lte: now } },
      data: { status: BackupJobStatus.RUNNING, startedAt: now, attempts: { increment: 1 }, error: null }
    });
    if (claim.count === 1) claimed.push({ ...candidate, attempts: candidate.attempts + 1 });
  }
  await Promise.all(claimed.map(executeBackupJob));
}

async function executeBackupJob(job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number }) {
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
      data: { status: BackupJobStatus.COMPLETED, finishedAt: new Date(), error: null }
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
          attempts: { decrement: 1 },
          availableAt: new Date(Date.now() + 30_000),
          error: "Een andere backup draait; job opnieuw ingepland."
        }
      });
      return;
    }
    await retryOrFail(job, error instanceof Error ? error.message : "Onbekende backupfout.");
  }
}

async function retryOrFail(
  job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number },
  error: string,
  backupId?: string
) {
  const retryCount = Math.max(0, Math.min(Number(await getSetting("backup.retry.count", job.tenantId)) || 0, 10));
  if (job.attempts <= retryCount) {
    const delayMs = Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 15 * 60_000);
    await prisma.backupJob.update({
      where: { id: job.id },
      data: { status: BackupJobStatus.PENDING, startedAt: null, availableAt: new Date(Date.now() + delayMs), error }
    });
    return;
  }
  await finishFailed(job, error, backupId);
}

async function finishFailed(
  job: { id: string; fortigateId: string; tenantId: string; requestedByUserId: string | null; attempts: number },
  error: string,
  backupId?: string
) {
  await prisma.backupJob.update({
    where: { id: job.id },
    data: { status: BackupJobStatus.FAILED, finishedAt: new Date(), error }
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
