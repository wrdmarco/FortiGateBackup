import cron from "node-cron";
import { processBackupJobs } from "@/lib/backup-jobs";
import { runDueBackups } from "@/lib/scheduler";
import { processSecurityAnalysisJobs } from "@/lib/security/analysis-worker";

const jobTimer = setInterval(() => {
  void processBackupJobs().catch((error) => console.error(error));
}, 5_000);
jobTimer.unref();
void processBackupJobs().catch((error) => console.error(error));
const analysisTimer = setInterval(() => {
  void processSecurityAnalysisJobs().catch((error) => console.error(error));
}, 5_000);
analysisTimer.unref();
void processSecurityAnalysisJobs().catch((error) => console.error(error));

cron.schedule("* * * * *", async () => {
  try {
    await runDueBackups();
  } catch (error) {
    console.error(error);
  }
});

console.log("FortiGate Backup Portal worker started.");
