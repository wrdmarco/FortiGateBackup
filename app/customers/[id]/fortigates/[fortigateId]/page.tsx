import { notFound } from "next/navigation";
import { deleteFortiGate, runBackupAction } from "@/app/actions";
import { BackupHistoryModal } from "@/components/backup-history-modal";
import { FirmwareStatus } from "@/components/firmware-status";
import { FortiGateSummary } from "@/components/fortigate-summary";
import { Modal } from "@/components/modal";
import { ActionLink, Button, Card, PageHeader, Shell } from "@/components/ui";
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
  const [timeZone, backupHistory] = await Promise.all([
    getTenantTimeZone(device.customer.tenantId),
    prisma.backup.findMany({
      where: { fortigateId: device.id },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const latestBackup = backupHistory[0] ?? device.backups[0];
  const latestStoredBackup = backupHistory.find((backup) => backup.filename);
  const returnTo = `/customers/${device.customerId}/fortigates/${device.id}`;
  const backupRows = backupHistory.map((backup) => ({
    id: backup.id,
    createdAt: formatDateTime(backup.createdAt, timeZone),
    status: backup.status,
    sha256: backup.sha256,
    error: backup.error,
    filesize: backup.filesize,
    filename: backup.filename,
    itGlueUploaded: Boolean(backup.itGlueUploadedAt),
    itGlueError: backup.itGlueError,
    downloadHref: `/api/backups/${backup.id}/download`,
    diffHref: `${returnTo}/backups/${backup.id}/diff`
  }));

  return (
    <Shell>
      <PageHeader
        title={device.hostname ?? device.managementUrl}
        description={`${device.customer.name} - ${device.customer.tenant.name}`}
        actions={
          <>
            <ActionLink href={`/customers/${device.customerId}`}>Klant</ActionLink>
            <Modal
              title="Backups"
              description="Alle backup runs voor deze FortiGate, inclusief unchanged."
              trigger={<Button variant="secondary">Backups</Button>}
            >
              <BackupHistoryModal backups={backupRows} canDownload={canDownloadBackup} canReadDiff={canReadDiff} />
            </Modal>
            {canDownloadBackup && latestStoredBackup?.filename ? (
              <ActionLink href={`/api/backups/${latestStoredBackup.id}/download`} variant="primary">Laatste backup downloaden</ActionLink>
            ) : null}
            {canUpdate ? <ActionLink href={`${returnTo}/edit`}>Bewerken</ActionLink> : null}
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
    </Shell>
  );
}
