import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BackupJobStatus, BackupJobTrigger, BackupStatus, TenantKind, UserRole } from "@prisma/client";
import { enqueueManualBackup, processBackupJobs } from "@/lib/backup-jobs";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";

test("backupjobs worden idempotent gequeued, atomair geclaimd en begrensd opnieuw geprobeerd", async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const tenantId = `job_tenant_${suffix}`;
  const userId = `job_user_${suffix}`;
  const inactiveCustomerId = `job_customer_inactive_${suffix}`;
  const activeCustomerId = `job_customer_active_${suffix}`;
  const inactiveDeviceId = `job_device_inactive_${suffix}`;
  const retryDeviceId = `job_device_retry_${suffix}`;
  const originalCwd = process.cwd();
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "fortigate-backup-jobs-"));
  process.chdir(dataDirectory);

  try {
    await prisma.tenant.create({
      data: { id: tenantId, name: "Backupjob klant", slug: `backupjob-${suffix}`, kind: TenantKind.CUSTOMER }
    });
    await prisma.user.create({
      data: { id: userId, tenantId, email: `jobs-${suffix}@example.test`, role: UserRole.ADMIN }
    });
    await prisma.customer.createMany({
      data: [
        { id: inactiveCustomerId, tenantId, name: "Inactive", active: false },
        { id: activeCustomerId, tenantId, name: "Active", active: true }
      ]
    });
    const encryptedToken = encryptSecret("test-api-token-value");
    await prisma.fortiGate.createMany({
      data: [
        {
          id: inactiveDeviceId,
          customerId: inactiveCustomerId,
          managementUrl: "https://10.0.0.1",
          httpsPort: 443,
          apiTokenEncrypted: encryptedToken,
          tlsVerify: true
        },
        {
          id: retryDeviceId,
          customerId: activeCustomerId,
          managementUrl: "http://127.0.0.1",
          httpsPort: 443,
          apiTokenEncrypted: encryptedToken,
          tlsVerify: false
        }
      ]
    });
    await prisma.systemSetting.create({
      data: { tenantId, key: "backup.retry.count", value: "1" }
    });

    const firstEnqueue = await enqueueManualBackup({ fortigateId: inactiveDeviceId, tenantId, userId });
    const secondEnqueue = await enqueueManualBackup({ fortigateId: inactiveDeviceId, tenantId, userId });
    assert.equal(firstEnqueue.created, true);
    assert.equal(secondEnqueue.created, false);
    assert.equal(secondEnqueue.job.id, firstEnqueue.job.id);
    assert.equal(
      await prisma.backupJob.count({
        where: { fortigateId: inactiveDeviceId, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING] } }
      }),
      1
    );

    const firstProcessor = processBackupJobs();
    const joinedProcessor = processBackupJobs();
    assert.equal(joinedProcessor, firstProcessor);
    await firstProcessor;
    const inactiveJob = await prisma.backupJob.findUniqueOrThrow({ where: { id: firstEnqueue.job.id } });
    assert.equal(inactiveJob.status, BackupJobStatus.FAILED);
    assert.equal(inactiveJob.attempts, 1);
    assert.match(inactiveJob.error ?? "", /niet actief/i);

    const retryJob = await prisma.backupJob.create({
      data: {
        fortigateId: retryDeviceId,
        tenantId,
        requestedByUserId: userId,
        trigger: BackupJobTrigger.MANUAL
      }
    });
    await processBackupJobs();
    const afterFirstAttempt = await prisma.backupJob.findUniqueOrThrow({ where: { id: retryJob.id } });
    assert.equal(afterFirstAttempt.status, BackupJobStatus.PENDING);
    assert.equal(afterFirstAttempt.attempts, 1);
    assert.ok(afterFirstAttempt.availableAt > (afterFirstAttempt.startedAt ?? new Date(0)));
    assert.equal(await prisma.backup.count({ where: { fortigateId: retryDeviceId, status: BackupStatus.FAILED } }), 1);

    await prisma.backupJob.update({
      where: { id: retryJob.id },
      data: { availableAt: new Date(Date.now() - 1_000) }
    });
    await processBackupJobs();
    const finalJob = await prisma.backupJob.findUniqueOrThrow({ where: { id: retryJob.id } });
    assert.equal(finalJob.status, BackupJobStatus.FAILED);
    assert.equal(finalJob.attempts, 2);
    assert.ok(finalJob.finishedAt);
    assert.equal(await prisma.backup.count({ where: { fortigateId: retryDeviceId, status: BackupStatus.FAILED } }), 2);

    await processBackupJobs();
    assert.equal((await prisma.backupJob.findUniqueOrThrow({ where: { id: retryJob.id } })).attempts, 2);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: "backup.job.failed" } }), 2);
  } finally {
    process.chdir(originalCwd);
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
