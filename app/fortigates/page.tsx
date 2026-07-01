import Link from "next/link";
import { createFortiGate, deleteFortiGate, runBackupAction, updateFortiGate } from "@/app/actions";
import { FortiGateWizard } from "@/components/fortigate-wizard";
import { FortiGateSummary } from "@/components/fortigate-summary";
import { FirmwareStatus } from "@/components/firmware-status";
import { Modal } from "@/components/modal";
import { Badge, Button, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZoneMap } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function FortiGatesPage({
  searchParams
}: {
  searchParams?: Promise<{ add?: string; customerId?: string; edit?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const customerWhere = isSuperAdmin(user) ? { active: true } : { active: true, tenantId: user.tenantId ?? "" };
  const fortigateWhere = isSuperAdmin(user) ? {} : { customer: { tenantId: user.tenantId ?? "" } };
  const [customers, devices] = await Promise.all([
    prisma.customer.findMany({ where: customerWhere, orderBy: { name: "asc" } }),
    prisma.fortiGate.findMany({
      where: fortigateWhere,
      include: {
        customer: true,
        backups: { orderBy: { createdAt: "desc" }, take: 5 },
        logs: { orderBy: { createdAt: "desc" }, take: 3 }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const editDevice = devices.find((device) => device.id === params?.edit);
  const timeZones = await getTenantTimeZoneMap(devices.map((device) => device.customer.tenantId));
  const formAction = editDevice ? updateFortiGate : createFortiGate;
  const selectedCustomerId = customers.some((customer) => customer.id === params?.customerId)
    ? params?.customerId
    : undefined;
  const shouldOpenAddWizard = params?.add === "1" || Boolean(selectedCustomerId);

  return (
    <Shell>
      <PageHeader
        title="FortiGates"
        description="Beheer API-toegang, backupstatus, firmware en diagnose per firewall."
        actions={
          <Modal
            title="FortiGate toevoegen"
            description="Begeleide setup voor REST API-token, connectiegegevens en backupschema."
            defaultOpen={shouldOpenAddWizard}
            trigger={<Button>FortiGate toevoegen</Button>}
          >
            <FortiGateWizard customers={customers} action={createFortiGate} defaultCustomerId={selectedCustomerId} />
          </Modal>
        }
      />
      {editDevice ? (
        <Modal
          title="FortiGate bewerken"
          description="Wijzig connectiegegevens zonder de bestaande API-token te tonen."
          defaultOpen
          trigger={<span />}
        >
        <form action={formAction} className="grid gap-4">
          {editDevice ? <input type="hidden" name="id" value={editDevice.id} /> : null}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Klant</span>
            <select
              className="rounded-md border border-border bg-surface px-3 py-2"
              name="customerId"
              defaultValue={editDevice?.customerId}
              required
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Management URL"
            name="managementUrl"
            type="url"
            defaultValue={editDevice?.managementUrl}
            required
          />
          <Field
            label="HTTPS poort"
            name="httpsPort"
            type="number"
            defaultValue={editDevice?.httpsPort ?? 443}
            required
          />
          <Field
            label={editDevice ? "Nieuwe API-token" : "API-token"}
            name="apiToken"
            required={!editDevice}
          />
          {editDevice ? (
            <p className="text-xs text-muted-foreground">
              Laat leeg om de bestaande API-token te behouden.
            </p>
          ) : null}
          <Field label="VDOM" name="vdom" defaultValue={editDevice?.vdom ?? ""} />
          <Field label="IT Glue configuration ID" name="itGlueConfigurationId" defaultValue={editDevice?.itGlueConfigurationId ?? ""} />
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Schema</span>
            <select
              className="rounded-md border border-border bg-surface px-3 py-2"
              name="scheduleType"
              defaultValue={editDevice?.scheduleType ?? "DAILY"}
            >
              <option value="HOURLY">Elk uur</option>
              <option value="DAILY">Dagelijks</option>
              <option value="WEEKLY">Wekelijks</option>
              <option value="MONTHLY">Maandelijks</option>
              <option value="CRON">Cron</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="tlsVerify" type="hidden" value="false" />
            <input
              name="tlsVerify"
              type="checkbox"
              value="true"
              defaultChecked={editDevice?.tlsVerify ?? false}
            />
            TLS verify
          </label>
          <div className="flex flex-wrap gap-2">
            <Button>{editDevice ? "Wijzigingen opslaan" : "Opslaan"}</Button>
            {editDevice ? (
              <Link
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted"
                href="/fortigates"
              >
                Annuleren
              </Link>
            ) : null}
          </div>
        </form>
        </Modal>
      ) : null}
      <div className="mt-6">
        <TableShell>
          <table className="table-pro w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Hostname</th>
                <th className="px-3 py-2">Klant</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Firmware</th>
                <th className="px-3 py-2">Laatste backup</th>
                <th className="px-3 py-2">IT Glue</th>
                <th className="px-3 py-2">Laatste log</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const latestLog = device.logs[0];
                const timeZone = timeZones.get(device.customer.tenantId);
                const logTone =
                  latestLog?.level === "ERROR"
                    ? "text-red-700 dark:text-red-300"
                    : latestLog?.level === "WARN"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-muted-foreground";

                return (
                  <tr key={device.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{device.hostname ?? device.managementUrl}</td>
                    <td className="px-3 py-2">
                      <Link className="font-medium hover:underline" href={`/customers/${device.customer.id}`}>
                        {device.customer.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{device.model ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="grid gap-2">
                        <span>{[device.firmwareVersion, device.firmwareBuild].filter(Boolean).join(" ") || "-"}</span>
                        <FirmwareStatus version={device.firmwareVersion} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {device.backups[0]?.status ? (
                        <Badge tone={device.backups[0].status === "FAILED" ? "danger" : device.backups[0].status === "CHANGED" ? "warning" : "success"}>
                          {device.backups[0].status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">nog niet uitgevoerd</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {device.itGlueConfigurationId ? <Badge tone="success">Config {device.itGlueConfigurationId}</Badge> : <Badge>Niet gekoppeld</Badge>}
                    </td>
                    <td className="max-w-[360px] px-3 py-2">
                      {latestLog ? (
                        <div className="grid gap-1">
                          <div className={`font-medium ${logTone}`}>
                            {latestLog.level} - {latestLog.event}
                          </div>
                          <div className="text-muted-foreground">{latestLog.message}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(latestLog.createdAt, timeZone)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">nog geen logregels</span>
                      )}
                    </td>
                    <td className="flex flex-wrap gap-2 px-3 py-2">
                      <Modal
                        title="FortiGate informatie"
                        description="Technische summary, bereikbaarheid, licenties, backups en diagnose."
                        trigger={<Button variant="secondary">Info</Button>}
                      >
                        <FortiGateSummary device={device} timeZone={timeZone} />
                      </Modal>
                      <form action={runBackupAction}>
                        <input type="hidden" name="id" value={device.id} />
                        <Button>Backup</Button>
                      </form>
                      <Link
                        className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted"
                        href={`/fortigates?edit=${device.id}`}
                      >
                        Edit
                      </Link>
                      <form action={deleteFortiGate}>
                        <input type="hidden" name="id" value={device.id} />
                        <Button variant="danger">
                          Delete
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </div>
    </Shell>
  );
}
