import { createFortiGate, runBackupAction } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FortiGatesPage() {
  const user = await requireUser();
  const customerWhere = isSuperAdmin(user) ? { active: true } : { active: true, tenantId: user.tenantId ?? "" };
  const fortigateWhere = isSuperAdmin(user) ? {} : { customer: { tenantId: user.tenantId ?? "" } };
  const [customers, devices] = await Promise.all([
    prisma.customer.findMany({ where: customerWhere, orderBy: { name: "asc" } }),
    prisma.fortiGate.findMany({
      where: fortigateWhere,
      include: {
        customer: true,
        backups: { orderBy: { createdAt: "desc" }, take: 1 },
        logs: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <Shell>
      <h1 className="text-3xl font-semibold">FortiGates</h1>
      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <form action={createFortiGate} className="grid gap-4 rounded-md border border-border p-4">
          <h2 className="text-lg font-semibold">FortiGate toevoegen</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Klant</span>
            <select className="rounded-md border border-border px-3 py-2" name="customerId" required>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Management URL" name="managementUrl" type="url" required />
          <Field label="HTTPS poort" name="httpsPort" type="number" defaultValue={443} required />
          <Field label="API-token" name="apiToken" required />
          <Field label="VDOM" name="vdom" />
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Schema</span>
            <select className="rounded-md border border-border px-3 py-2" name="scheduleType">
              <option value="HOURLY">Elk uur</option>
              <option value="DAILY">Dagelijks</option>
              <option value="WEEKLY">Wekelijks</option>
              <option value="MONTHLY">Maandelijks</option>
              <option value="CRON">Cron</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="tlsVerify" type="checkbox" defaultChecked />
            TLS verify
          </label>
          <Button>Opslaan</Button>
        </form>
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2">Hostname</th>
                <th className="px-3 py-2">Klant</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Firmware</th>
                <th className="px-3 py-2">Laatste backup</th>
                <th className="px-3 py-2">Laatste log</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const latestLog = device.logs[0];
                const logTone =
                  latestLog?.level === "ERROR"
                    ? "text-red-700 dark:text-red-300"
                    : latestLog?.level === "WARN"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-muted-foreground";

                return (
                  <tr key={device.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{device.hostname ?? device.managementUrl}</td>
                    <td className="px-3 py-2">{device.customer.name}</td>
                    <td className="px-3 py-2">{device.model ?? "-"}</td>
                    <td className="px-3 py-2">
                      {[device.firmwareVersion, device.firmwareBuild].filter(Boolean).join(" ") || "-"}
                    </td>
                    <td className="px-3 py-2">{device.backups[0]?.status ?? "nog niet uitgevoerd"}</td>
                    <td className="max-w-[360px] px-3 py-2">
                      {latestLog ? (
                        <div className="grid gap-1">
                          <div className={`font-medium ${logTone}`}>
                            {latestLog.level} - {latestLog.event}
                          </div>
                          <div className="text-muted-foreground">{latestLog.message}</div>
                          <div className="text-xs text-muted-foreground">
                            {latestLog.createdAt.toLocaleString("nl-NL")}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">nog geen logregels</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <form action={runBackupAction}>
                        <input type="hidden" name="id" value={device.id} />
                        <Button>Backup</Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
