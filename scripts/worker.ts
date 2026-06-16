import cron from "node-cron";
import { runDueBackups } from "@/lib/scheduler";

cron.schedule("* * * * *", async () => {
  try {
    await runDueBackups();
  } catch (error) {
    console.error(error);
  }
});

console.log("FortiGate Backup Portal worker started.");
