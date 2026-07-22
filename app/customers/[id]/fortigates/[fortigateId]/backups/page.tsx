import { BackupStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { ActionLink, Badge, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";
import { tenantTransaction } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const backupStatuses = new Set<BackupStatus>([BackupStatus.CHANGED, BackupStatus.UNCHANGED, BackupStatus.FAILED]);

export default async function CustomerFortiGateBackupsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string; fortigateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("backups.read");
  const { id, fortigateId } = await params;
  const queryParams = await searchParams;
  const requestedStatus = firstQueryValue(queryParams.status);
  const status = backupStatuses.has(requestedStatus as BackupStatus) ? requestedStatus as BackupStatus : null;
  const requestedPage = parsePageParam(queryParams.page);
  const device = await prisma.fortiGate.findFirst({
    where: { id: fortigateId, customerId: id },
    include: { customer: { include: { tenant: true } } }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  const [canDownloadBackup, canReadDiff] = await Promise.all([
    hasPermission(user, "backups.download"),
    hasPermission(user, "backups.diff.read")
  ]);
  const backupWhere = { fortigateId: device.id, ...(status ? { status } : {}) };
  const totalBackups = await prisma.backup.count({ where: backupWhere });
  const page = normalizePage(requestedPage, totalBackups, PAGE_SIZE);
  const backups = await tenantTransaction(device.customer.tenantId,(tx)=>tx.backup.findMany({
    where: backupWhere,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include:{configArtifact:{select:{analysis:{select:{id:true,status:true,report:{select:{id:true}}}}}}}
  }));
  const timeZone = await getTenantTimeZone(device.customer.tenantId);
  const detailHref = `/customers/${device.customerId}/fortigates/${device.id}`;

  return (
    <Shell>
      <PageHeader
        title="Backups"
        description={`${device.customer.name} - ${device.hostname ?? device.managementUrl}`}
        actions={<ActionLink href={detailHref}>Terug naar firewall</ActionLink>}
      />
      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <label className="grid min-w-56 gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select className="min-h-11 rounded-md border border-border bg-surface px-3 py-2" defaultValue={status ?? ""} name="status">
            <option value="">Alle statussen</option>
            <option value={BackupStatus.CHANGED}>Gewijzigd</option>
            <option value={BackupStatus.UNCHANGED}>Ongewijzigd</option>
            <option value={BackupStatus.FAILED}>Mislukt</option>
          </select>
        </label>
        <button className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-primary/50 hover:bg-muted" type="submit">
          Filteren
        </button>
        {status ? <ActionLink href={detailHref + "/backups"}>Filter wissen</ActionLink> : null}
      </form>
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Datum</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SHA256 / fout</th>
              <th className="px-3 py-2">Grootte</th>
              <th className="px-3 py-2">IT Glue</th>
              <th className="px-3 py-2">Autotask</th>
              <th className="px-3 py-2">Analyse</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {backups.length ? backups.map((backup) => (
              <tr key={backup.id} className="border-t border-border align-top">
                <td className="px-3 py-2">{formatDateTime(backup.createdAt, timeZone)}</td>
                <td className="px-3 py-2">
                  <Badge tone={backup.status === "FAILED" ? "danger" : backup.status === "CHANGED" ? "warning" : "success"}>{backup.status}</Badge>
                </td>
                <td className="max-w-[460px] truncate px-3 py-2 font-mono text-xs">{backup.sha256 ?? backup.error ?? "-"}</td>
                <td className="px-3 py-2">{backup.filesize}</td>
                <td className="px-3 py-2">
                  {backup.itGlueUploadedAt ? <Badge tone="success">Geupload</Badge> : backup.itGlueError ? <Badge tone="warning">Fout</Badge> : <Badge>-</Badge>}
                </td>
                <td className="px-3 py-2">
                  {backup.autotaskTicketId ? <Badge tone="success">Ticket {backup.autotaskTicketId}</Badge> : backup.autotaskError ? <Badge tone="warning">Fout</Badge> : <Badge>-</Badge>}
                </td>
                <td className="px-3 py-2">{backup.status==="UNCHANGED"?<Badge>Geen nieuwe analyse</Badge>:backup.status==="FAILED"?<Badge tone="danger">Niet analyseerbaar</Badge>:!backup.configArtifact?.analysis?<Badge>Rapportage niet geconfigureerd</Badge>:backup.configArtifact.analysis.status==="COMPLETED"?<div className="flex gap-2"><ActionLink href={`/security/analyses/${backup.configArtifact.analysis.id}`}>Open analyse</ActionLink>{backup.configArtifact.analysis.report?<ActionLink href={`/api/security/reports/${backup.configArtifact.analysis.report.id}`}>PDF</ActionLink>:null}</div>:<Badge tone={backup.configArtifact.analysis.status==="FAILED"||backup.configArtifact.analysis.status==="BLOCKED"?"danger":"warning"}>{backup.configArtifact.analysis.status==="RUNNING"||backup.configArtifact.analysis.status==="PENDING"?"Analyse in behandeling":"Analyse mislukt"}</Badge>}</td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename && (canDownloadBackup || canReadDiff) ? (
                    <>
                      {canDownloadBackup ? <ActionLink href={`/api/backups/${backup.id}/download`}>Download</ActionLink> : null}
                      {canReadDiff ? <ActionLink href={`${detailHref}/backups/${backup.id}/diff`}>Diff</ActionLink> : null}
                    </>
                  ) : <span className="text-muted-foreground">{backup.filename ? "Geen actie toegestaan" : "Geen bestand"}</span>}
                </td>
              </tr>
            )) : (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>Nog geen backups voor deze FortiGate.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
      <ServerPagination
        itemLabel="backup runs"
        page={page}
        pageSize={PAGE_SIZE}
        path={`${detailHref}/backups`}
        query={{ status }}
        totalItems={totalBackups}
      />
    </Shell>
  );
}
