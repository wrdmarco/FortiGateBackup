import cron from "node-cron";
import { processBackupJobs } from "@/lib/backup-jobs";
import { runDueBackups } from "@/lib/scheduler";

const jobTimer = setInterval(() => {
  void processBackupJobs().catch((error) => console.error(error));
}, 5_000);
jobTimer.unref();
void processBackupJobs().catch((error) => console.error(error));

cron.schedule("* * * * *", async () => {
  try {
    await runDueBackups();
  } catch (error) {
    console.error(error);
  }
});

console.log("FortiGate Backup Portal worker started.");
