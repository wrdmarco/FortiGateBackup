import { ScheduleType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runBackup } from "@/lib/fortigate";

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
  const due = await prisma.fortiGate.findMany({
    where: {
      active: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
    },
    take: 20
  });

  for (const device of due) {
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
