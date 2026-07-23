import { notFound } from "next/navigation";
import { deleteFortiGate, runBackupAction } from "@/app/actions";
import { BackupHistoryModal } from "@/components/backup-history-modal";
import { FirmwareStatus } from "@/components/firmware-status";
import { FortiGateSummary } from "@/components/fortigate-summary";
import { Modal } from "@/components/modal";
import { SecurityScoreChart } from "@/components/security-score-chart";
import { ActionLink, Badge, Button, Card, PageHeader, Shell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { userPermissionKeys } from "@/lib/rbac";
import { fortigateSecuritySnapshot } from "@/lib/security/queries";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function CustomerFortiGatePage({
  params
}: {
  params: Promise<{ id: string; fortigateId: string }>;
}) {
  const user = await requirePermission("fortigates.read");
  const { id, fortigateId } = await params;
  const device = await prisma.fortiGate.findFirst({
    where: { id: fortigateId, customerId: id },
    include: { customer: { include: { tenant: true } } }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);

  const permissionKeys = await userPermissionKeys(user);
  const canUpdate = permissionKeys.has("fortigates.update");
  const canDelete = permissionKeys.has("fortigates.delete");
  const canRunBackup = permissionKeys.has("fortigates.backup.run");
  const canReadBackups = permissionKeys.has("backups.read");
  const canDownloadBackup = permissionKeys.has("backups.download");
  const canReadDiff = permissionKeys.has("backups.diff.read");
  const canReadLogs = permissionKeys.has("fortigates.logs.read");
  const canReadFirmware = permissionKeys.has("fortigates.firmware.read");
  const canReadSecurity = permissionKeys.has("security.analyses.read");
  const [timeZone, backupHistory, latestStoredBackup, logs, securitySnapshot] = await Promise.all([
    getTenantTimeZone(device.customer.tenantId),
    canReadBackups
      ? prisma.backup.findMany({
          where: { fortigateId: device.id },
          orderBy: { createdAt: "desc" },
          take: 50
        })
      : Promise.resolve([]),
    canReadBackups
      ? prisma.backup.findFirst({
          where: { fortigateId: device.id, filename: { not: null } },
          orderBy: { createdAt: "desc" }
        })
      : Promise.resolve(null),
    canReadLogs
      ? prisma.fortiGateLog.findMany({
          where: { fortigateId: device.id },
          orderBy: { createdAt: "desc" },
          take: 8
        })
      : Promise.resolve([]),
    canReadSecurity
      ? fortigateSecuritySnapshot(device.customer.tenantId, device.id)
      : Promise.resolve(null)
  ]);
  const latestBackup = backupHistory[0];
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
    autotaskTicketId: backup.autotaskTicketId,
    autotaskError: backup.autotaskError,
    downloadHref: `/api/backups/${backup.id}/download`,
    diffHref: `${returnTo}/backups/${backup.id}/diff`
  }));
  const summaryBackups = latestStoredBackup && !backupHistory.some((backup) => backup.id === latestStoredBackup.id)
    ? [...backupHistory, latestStoredBackup]
    : backupHistory;
  const deviceWithBackupHistory = {
    ...device,
    firmwareVersion: canReadFirmware ? device.firmwareVersion : null,
    firmwareBuild: canReadFirmware ? device.firmwareBuild : null,
    uptime: canReadFirmware ? device.uptime : null,
    licenseInfo: canReadFirmware ? device.licenseInfo : null,
    backups: summaryBackups,
    logs
  };
  const currentAnalysis = securitySnapshot?.latestChanged?.configArtifact?.analysis ?? null;
  const scorePoints = securitySnapshot?.history.flatMap((backup) => {
    const analysis = backup.configArtifact?.analysis;
    return typeof analysis?.score === "number"
      ? [{ score: analysis.score, label: formatDateTime(backup.createdAt, timeZone) }]
      : [];
  }) ?? [];

  return (
    <Shell>
      <PageHeader
        title={device.hostname ?? device.managementUrl}
        description={`${device.customer.name} - ${device.customer.tenant.name}`}
        actions={
          <>
            {canReadBackups ? <Modal size="wide"
              title="Backups"
              description="De laatste 50 backup runs voor deze FortiGate, inclusief unchanged."
              trigger={<Button variant="secondary">Backups</Button>}
            >
              <BackupHistoryModal backups={backupRows} canDownload={canDownloadBackup} canReadDiff={canReadDiff} />
            </Modal> : null}
            {canReadBackups ? <ActionLink href={`${returnTo}/backups`} variant="secondary">Volledige historie</ActionLink> : null}
            {canReadBackups && canDownloadBackup && latestStoredBackup?.filename ? (
              <ActionLink href={`/api/backups/${latestStoredBackup.id}/download`} variant="primary">Laatste backup downloaden</ActionLink>
            ) : null}
            {canUpdate ? <ActionLink href={`${returnTo}/edit`}>Bewerken</ActionLink> : null}
            {canUpdate ? <ActionLink href={`${returnTo}/certificate`} variant="secondary">TLS-certificaat</ActionLink> : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card title="Model" value={device.model ?? "-"} detail={device.serialNumber ?? "Geen serienummer"} />
        {canReadFirmware ? <Card title="Firmware" value={device.firmwareVersion ?? "-"} detail={device.firmwareBuild ? `Build ${device.firmwareBuild}` : "Geen build"} /> : null}
        {canReadBackups ? <Card title="Laatste backup" value={latestBackup?.status ?? "-"} detail={latestBackup ? formatDateTime(latestBackup.createdAt, timeZone) : "Nog niet uitgevoerd"} /> : null}
        <Card title="Schema" value={device.scheduleType==="MANUAL"?"Alleen handmatig":device.scheduleType} detail={device.scheduleType==="MANUAL"?"Geen automatische backups":device.cronExpression ?? "Standaard schema"} />
        <Card title="TLS" value="Altijd aan" detail={device.tlsCertificateFingerprint ? "Geaccepteerde fingerprint" : "PKI-validatie"} />
        {canReadSecurity ? <Card
          title="Beveiligingsscore"
          value={currentAnalysis?.status === "COMPLETED" && currentAnalysis.score !== null ? `${currentAnalysis.score}%` : securityStatusLabel(currentAnalysis?.status, Boolean(securitySnapshot?.latestChanged))}
          detail={currentAnalysis?.status === "COMPLETED" ? `${currentAnalysis.criticalCount} critical · ${currentAnalysis.highCount} high` : "Nieuwste gewijzigde configuratie"}
        /> : null}
      </div>

      {canReadSecurity ? <section className="mt-6 rounded-md border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Beveiligingsscore</h2>
            <p className="mt-1 text-sm text-muted-foreground">Actuele score en historie van gewijzigde FortiOS-configuraties.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {currentAnalysis?.status === "COMPLETED" && currentAnalysis.score !== null ? <Badge tone={currentAnalysis.score >= 80 ? "success" : currentAnalysis.score >= 60 ? "warning" : "danger"}>{currentAnalysis.score}%</Badge> : <Badge tone={currentAnalysis?.status === "FAILED" || currentAnalysis?.status === "BLOCKED" ? "danger" : "warning"}>{securityStatusLabel(currentAnalysis?.status, Boolean(securitySnapshot?.latestChanged))}</Badge>}
            {currentAnalysis?.status === "COMPLETED" ? <ActionLink href={`/security/analyses/${currentAnalysis.id}`}>Open analyse</ActionLink> : null}
            <ActionLink href={`${returnTo}/security`} variant="secondary">Volledige scorehistorie</ActionLink>
          </div>
        </div>
        <div className="mt-5"><SecurityScoreChart points={scorePoints}/></div>
      </section> : null}

      <div className={`mt-6 grid gap-4 ${canReadLogs ? "lg:grid-cols-[1.1fr_0.9fr]" : ""}`}>
        <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Firewall status</h2>
              <p className="mt-1 text-sm text-muted-foreground">{device.managementUrl}:{device.httpsPort}</p>
            </div>
            {canReadFirmware ? <FirmwareStatus version={device.firmwareVersion} /> : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {canRunBackup ? (
              <form action={runBackupAction}>
                <input type="hidden" name="id" value={device.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
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

        {canReadLogs ? <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <h2 className="font-semibold">Laatste logs</h2>
          <div className="mt-4 grid gap-3">
            {logs.length ? logs.map((log) => (
              <div key={log.id} className="rounded-md border border-border bg-surface-soft p-3 text-sm">
                <div className={log.level === "ERROR" ? "font-medium text-red-700 dark:text-red-300" : "font-medium"}>
                  {log.level} - {log.event}
                </div>
                <div className="mt-1 text-muted-foreground">{log.message}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(log.createdAt, timeZone)}</div>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nog geen logregels.</p>}
          </div>
        </section> : null}
      </div>

      <section className="mt-6 rounded-md border border-border bg-surface p-5 shadow-sm">
        <div className="mb-5 border-b border-border pb-4">
          <h2 className="font-semibold">FortiGate informatie</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Technische summary, bereikbaarheid, licenties, backups en diagnose.
          </p>
        </div>
        {canReadFirmware && canReadBackups && canReadLogs ? (
          <FortiGateSummary device={deviceWithBackupHistory} timeZone={timeZone} />
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <InfoRow label="Management" value={`${device.managementUrl}:${device.httpsPort}`} />
            <InfoRow label="Serienummer" value={device.serialNumber ?? "Niet uitgelezen"} />
            <InfoRow label="VDOM" value={device.vdom ?? "Global"} />
            <InfoRow label="TLS" value={device.tlsCertificateFingerprint ? "Aan · fingerprint geaccepteerd" : "Aan · PKI-validatie"} />
            <InfoRow label="Schema" value={device.scheduleType === "MANUAL" ? "Alleen handmatig" : device.scheduleType === "CRON" ? device.cronExpression ?? "Cron" : device.scheduleType} />
            {canReadFirmware ? <InfoRow label="Firmware" value={[device.firmwareVersion, device.firmwareBuild ? `build ${device.firmwareBuild}` : null].filter(Boolean).join(" ") || "Niet uitgelezen"} /> : null}
            {canReadBackups ? <InfoRow label="Laatste backup" value={latestBackup ? `${latestBackup.status} - ${formatDateTime(latestBackup.createdAt, timeZone)}` : "Nog niet uitgevoerd"} /> : null}
            {canReadBackups ? <InfoRow label="Laatste wijziging" value={latestStoredBackup ? formatDateTime(latestStoredBackup.createdAt, timeZone) : "Nog geen gewijzigde backup"} /> : null}
            {canReadLogs ? <InfoRow label="Laatste diagnose" value={logs[0] ? `${logs[0].level} - ${logs[0].event}` : "Nog geen logregels"} /> : null}
          </dl>
        )}
      </section>
    </Shell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}

function securityStatusLabel(status: string | undefined, hasChangedBackup: boolean) {
  if (!hasChangedBackup) return "Niet geanalyseerd";
  if (!status) return "Niet geanalyseerd";
  if (status === "PENDING" || status === "RUNNING") return "Wacht op analyse";
  if (status === "FAILED") return "Analyse mislukt";
  if (status === "BLOCKED") return "Analyse geblokkeerd";
  return status;
}
