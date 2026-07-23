import { ScheduleType } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { backupConcurrencyFromSetting, enqueueScheduledBackup } from "@/lib/backup-jobs";
import { nextCronOccurrence, nextZonedCalendarOccurrence } from "@/lib/cron-schedule";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";
import { normalizeTimeZone } from "@/lib/time";

const CLAIM_LEASE_MS = 30 * 60 * 1000;
let schedulerRun: Promise<void> | null = null;
let fairSelectionCursor = 0;

export function nextRun(
  type: ScheduleType,
  from = new Date(),
  cronExpression?: string | null,
  timeZone?: string | null
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  if (type === ScheduleType.HOURLY) return new Date(from.getTime() + 60 * 60 * 1000);
  if (type === ScheduleType.DAILY) return nextZonedCalendarOccurrence(from, "daily", normalizedTimeZone);
  if (type === ScheduleType.WEEKLY) return nextZonedCalendarOccurrence(from, "weekly", normalizedTimeZone);
  if (type === ScheduleType.MONTHLY) return nextZonedCalendarOccurrence(from, "monthly", normalizedTimeZone);
  if (type === ScheduleType.CRON) {
    if (!cronExpression?.trim()) throw new Error("CRON-schema mist een cronexpressie.");
    return nextCronOccurrence(cronExpression, from, normalizedTimeZone);
  }
  throw new Error(`Onbekend backupschema: ${type}.`);
}

export async function runDueBackups() {
  if (schedulerRun) return schedulerRun;
  const run = runDueBackupsInternal().finally(() => {
    if (schedulerRun === run) schedulerRun = null;
  });
  schedulerRun = run;
  return run;
}

async function runDueBackupsInternal() {
  const globalTenantId = await mainTenantId();
  const schedulerEnabled = (await getSetting("scheduler.enabled", globalTenantId)) !== "false";
  if (!schedulerEnabled) return;
  const maxParallelJobs = backupConcurrencyFromSetting(
    await getSetting("scheduler.maxParallelJobs", globalTenantId)
  );
  const tenants = await prisma.tenant.findMany({ where: { active: true }, select: { id: true } });
  const tenantScheduleStates = await Promise.all(
    tenants.map(async (tenant) => ({
      tenantId: tenant.id,
      enabled: (await getSetting("backup.schedule.enabled", tenant.id)) !== "false",
      timeZone: normalizeTimeZone(await getSetting("ui.timeZone", tenant.id))
    }))
  );
  const enabledTenantIds = tenantScheduleStates.filter((tenant) => tenant.enabled).map((tenant) => tenant.tenantId);
  const tenantTimeZones = new Map(tenantScheduleStates.map((tenant) => [tenant.tenantId, tenant.timeZone]));
  if (!enabledTenantIds.length) return;

  const now = new Date();
  const due = await prisma.fortiGate.findMany({
    where: {
      active: true,
      scheduleType: { not: ScheduleType.MANUAL },
      customer: {
        active: true,
        tenantId: { in: enabledTenantIds },
        tenant: { active: true }
      },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduleType: true,
      cronExpression: true,
      nextRunAt: true,
      customer: { select: { tenantId: true } }
    }
  });

  const selected = fairSelection(
    due.map((device) => ({
      ...device,
      timeZone: tenantTimeZones.get(device.customer.tenantId) ?? normalizeTimeZone()
    })),
    maxParallelJobs
  );
  const claimed: typeof selected = [];
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  for (const device of selected) {
    const claim = await prisma.fortiGate.updateMany({
      where: {
        id: device.id,
        active: true,
        scheduleType: { not: ScheduleType.MANUAL },
        customer: {
          active: true,
          tenantId: { in: enabledTenantIds },
          tenant: { active: true }
        },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
      },
      data: { nextRunAt: leaseUntil }
    });
    if (claim.count === 1) claimed.push(device);
  }

  await Promise.all(claimed.map((device) => runScheduledBackup(device)));
}

async function runScheduledBackup(device: {
  id: string;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  timeZone: string;
  customer: { tenantId: string };
}) {
  const stillScheduled=await prisma.fortiGate.findFirst({where:{id:device.id,active:true,scheduleType:{not:ScheduleType.MANUAL}},select:{id:true}});
  if(!stillScheduled){
    await prisma.fortiGate.updateMany({where:{id:device.id,scheduleType:ScheduleType.MANUAL},data:{nextRunAt:null}});
    return;
  }
  let queueFailed = false;
  try {
    const queued = await enqueueScheduledBackup({ fortigateId: device.id, tenantId: device.customer.tenantId });
    if (queued.created) {
      await auditLog({
        action: "backup.job.queued",
        tenantId: device.customer.tenantId,
        entity: "BackupJob",
        entityId: queued.job.id,
        metadata: { fortigateId: device.id, trigger: "scheduled" }
      });
    }
  } catch (error) {
    queueFailed = true;
    console.error(`Geplande backup voor FortiGate ${device.id} kon niet worden ingepland.`, error);
  } finally {
    let followingRun: Date;
    if (queueFailed) {
      followingRun = new Date(Date.now() + 60_000);
    } else {
      try {
        followingRun = nextRun(device.scheduleType, new Date(), device.cronExpression, device.timeZone);
      } catch (error) {
        followingRun = new Date(Date.now() + 24 * 60 * 60 * 1000);
        console.error(`Schema voor FortiGate ${device.id} is ongeldig; volgende poging over 24 uur.`, error);
      }
    }
    try {
      await prisma.fortiGate.update({ where: { id: device.id }, data: { nextRunAt: followingRun } });
    } catch (error) {
      console.error(`Volgend uitvoermoment voor FortiGate ${device.id} kon niet worden opgeslagen.`, error);
    }
  }
}

function fairSelection<T extends { customer: { tenantId: string } }>(devices: T[], maximum: number) {
  const grouped = new Map<string, T[]>();
  for (const device of devices) {
    const queue = grouped.get(device.customer.tenantId) ?? [];
    queue.push(device);
    grouped.set(device.customer.tenantId, queue);
  }

  const sortedQueues = Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  if (!sortedQueues.length) return [];
  const start = fairSelectionCursor % sortedQueues.length;
  const queues = [...sortedQueues.slice(start), ...sortedQueues.slice(0, start)];
  const selected: T[] = [];
  while (selected.length < maximum) {
    let progressed = false;
    for (const [, queue] of queues) {
      const device = queue.shift();
      if (!device) continue;
      selected.push(device);
      progressed = true;
      if (selected.length === maximum) break;
    }
    if (!progressed) break;
  }
  fairSelectionCursor = (start + selected.length) % sortedQueues.length;
  return selected;
}
