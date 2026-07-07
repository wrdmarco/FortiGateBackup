import { notFound } from "next/navigation";
import { ActionLink, Badge, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function CustomerFortiGateBackupsPage({
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
      backups: { orderBy: { createdAt: "desc" } }
    }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  const [canDownloadBackup, canReadDiff] = await Promise.all([
    hasPermission(user, "backups.download"),
    hasPermission(user, "backups.diff.read")
  ]);
  const timeZone = await getTenantTimeZone(device.customer.tenantId);
  const detailHref = `/customers/${device.customerId}/fortigates/${device.id}`;

  return (
    <Shell>
      <PageHeader
        title="Backups"
        description={`${device.customer.name} - ${device.hostname ?? device.managementUrl}`}
        actions={<ActionLink href={detailHref}>Terug naar firewall</ActionLink>}
      />
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
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {device.backups.length ? device.backups.map((backup) => (
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
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename ? (
                    <>
                      {canDownloadBackup ? <ActionLink href={`/api/backups/${backup.id}/download`}>Download</ActionLink> : null}
                      {canReadDiff ? <ActionLink href={`${detailHref}/backups/${backup.id}/diff`}>Diff</ActionLink> : null}
                    </>
                  ) : <span className="text-muted-foreground">Geen bestand</span>}
                </td>
              </tr>
            )) : (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>Nog geen backups voor deze FortiGate.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}
