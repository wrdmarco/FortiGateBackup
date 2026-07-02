import { ScheduleType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runBackup } from "@/lib/fortigate";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";

const activeJobs = new Set<string>();

export function nextRun(type: ScheduleType, from = new Date()) {
  const next = new Date(from);
  if (type === ScheduleType.HOURLY) next.setHours(next.getHours() + 1);
  if (type === ScheduleType.DAILY) next.setDate(next.getDate() + 1);
  if (type === ScheduleType.WEEKLY) next.setDate(next.getDate() + 7);
  if (type === ScheduleType.MONTHLY) next.setMonth(next.getMonth() + 1);
  if (type === ScheduleType.CRON) next.setMinutes(next.getMinutes() + 1);
  return next;
}

export async function runDueBackups() {
  const globalTenantId = await mainTenantId();
  const schedulerEnabled = (await getSetting("scheduler.enabled", globalTenantId)) !== "false";
  if (!schedulerEnabled) return;
  const maxParallelJobs = Math.max(1, Math.min(Number(await getSetting("scheduler.maxParallelJobs", globalTenantId)) || 20, 100));
  const due = await prisma.fortiGate.findMany({
    where: {
      active: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
    },
    include: { customer: true },
    take: maxParallelJobs
  });

  for (const device of due) {
    const tenantScheduleEnabled = (await getSetting("backup.schedule.enabled", device.customer.tenantId)) !== "false";
    if (!tenantScheduleEnabled) continue;
    if (activeJobs.has(device.id)) continue;
    activeJobs.add(device.id);
    try {
      await runBackup(device.id);
      await prisma.fortiGate.update({
        where: { id: device.id },
        data: { nextRunAt: nextRun(device.scheduleType) }
      });
    } finally {
      activeJobs.delete(device.id);
    }
  }
}
