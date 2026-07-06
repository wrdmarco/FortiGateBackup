import { notFound } from "next/navigation";
import { deleteFortiGate, runBackupAction } from "@/app/actions";
import { FirmwareStatus } from "@/components/firmware-status";
import { FortiGateSummary } from "@/components/fortigate-summary";
import { Modal } from "@/components/modal";
import { ActionLink, Badge, Button, Card, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function CustomerFortiGatePage({
  params
}: {
  params: Promise<{ id: string; fortigateId: string }>;
}) {
  const user = await requireTenantUser();
  const { id, fortigateId } = await params;
  const device = await prisma.fortiGate.findFirst({
    where: { id: fortigateId, customerId: id },
    include: {
      customer: { include: { tenant: true } },
      backups: { orderBy: { createdAt: "desc" }, take: 5 },
      logs: { orderBy: { createdAt: "desc" }, take: 8 }
    }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);

  const [canUpdate, canDelete, canRunBackup, canDownloadBackup, canReadDiff] = await Promise.all([
    hasPermission(user, "fortigates.update"),
    hasPermission(user, "fortigates.delete"),
    hasPermission(user, "fortigates.backup.run"),
    hasPermission(user, "backups.download"),
    hasPermission(user, "backups.diff.read")
  ]);
  const timeZone = await getTenantTimeZone(device.customer.tenantId);
  const latestBackup = device.backups[0];
  const returnTo = `/customers/${device.customerId}/fortigates/${device.id}`;

  return (
    <Shell>
      <PageHeader
        title={device.hostname ?? device.managementUrl}
        description={`${device.customer.name} - ${device.customer.tenant.name}`}
        actions={
          <>
            <ActionLink href={`/customers/${device.customerId}`}>Klant</ActionLink>
            <ActionLink href={`${returnTo}/backups`}>Backups</ActionLink>
            {canUpdate ? <ActionLink href={`${returnTo}/edit`} variant="primary">Bewerken</ActionLink> : null}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-5">
        <Card title="Model" value={device.model ?? "-"} detail={device.serialNumber ?? "Geen serienummer"} />
        <Card title="Firmware" value={device.firmwareVersion ?? "-"} detail={device.firmwareBuild ? `Build ${device.firmwareBuild}` : "Geen build"} />
        <Card title="Laatste backup" value={latestBackup?.status ?? "-"} detail={latestBackup ? formatDateTime(latestBackup.createdAt, timeZone) : "Nog niet uitgevoerd"} />
        <Card title="Schema" value={device.scheduleType} detail={device.cronExpression ?? "Standaard schema"} />
        <Card title="TLS verify" value={device.tlsVerify ? "Aan" : "Uit"} detail={device.vdom ? `VDOM ${device.vdom}` : "Geen VDOM"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Firewall status</h2>
              <p className="mt-1 text-sm text-muted-foreground">{device.managementUrl}:{device.httpsPort}</p>
            </div>
            <FirmwareStatus version={device.firmwareVersion} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Modal
              title="FortiGate informatie"
              description="Technische summary, bereikbaarheid, licenties, backups en diagnose."
              trigger={<Button variant="secondary">Info</Button>}
            >
              <FortiGateSummary device={device} timeZone={timeZone} />
            </Modal>
            {canRunBackup ? (
              <form action={runBackupAction}>
                <input type="hidden" name="id" value={device.id} />
                <Button>Backup draaien</Button>
              </form>
            ) : null}
            {canDelete ? (
              <Modal
                title="FortiGate verwijderen"
                description="Verwijder deze firewall inclusief backuprecords en opgeslagen configbestanden."
                trigger={<Button variant="danger">Verwijderen</Button>}
              >
                <form action={deleteFortiGate} className="grid gap-4">
                  <input type="hidden" name="id" value={device.id} />
                  <input type="hidden" name="returnTo" value={`/customers/${device.customerId}`} />
                  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                    Dit verwijdert alle backuprecords en bestanden van deze FortiGate.
                  </div>
                  <Button variant="danger">FortiGate definitief verwijderen</Button>
                </form>
              </Modal>
            ) : null}
          </div>
        </section>

        <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <h2 className="font-semibold">Laatste logs</h2>
          <div className="mt-4 grid gap-3">
            {device.logs.length ? device.logs.map((log) => (
              <div key={log.id} className="rounded-md border border-border bg-surface-soft p-3 text-sm">
                <div className={log.level === "ERROR" ? "font-medium text-red-700 dark:text-red-300" : "font-medium"}>
                  {log.level} - {log.event}
                </div>
                <div className="mt-1 text-muted-foreground">{log.message}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(log.createdAt, timeZone)}</div>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nog geen logregels.</p>}
          </div>
        </section>
      </div>

      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[920px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Datum</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SHA256 / fout</th>
              <th className="px-3 py-2">Grootte</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {device.backups.map((backup) => (
              <tr key={backup.id} className="border-t border-border">
                <td className="px-3 py-2">{formatDateTime(backup.createdAt, timeZone)}</td>
                <td className="px-3 py-2">
                  <Badge tone={backup.status === "FAILED" ? "danger" : backup.status === "CHANGED" ? "warning" : "success"}>{backup.status}</Badge>
                </td>
                <td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs">{backup.sha256 ?? backup.error ?? "-"}</td>
                <td className="px-3 py-2">{backup.filesize}</td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename ? (
                    <>
                      {canDownloadBackup ? <ActionLink href={`/api/backups/${backup.id}/download`}>Download</ActionLink> : null}
                      {canReadDiff ? <ActionLink href={`${returnTo}/backups/${backup.id}/diff`}>Diff</ActionLink> : null}
                    </>
                  ) : <span className="text-muted-foreground">Geen bestand</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}
