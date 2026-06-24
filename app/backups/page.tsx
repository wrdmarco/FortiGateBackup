import { ActionLink, Badge, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const user = await requireUser();
  const backups = await prisma.backup.findMany({
    where: isSuperAdmin(user) ? {} : { fortigate: { customer: { tenantId: user.tenantId ?? "" } } },
    include: { fortigate: { include: { customer: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return (
    <Shell>
      <PageHeader
        title="Backups"
        description="Controleer backupresultaten, download configuraties en vergelijk wijzigingen."
      />
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Datum</th>
              <th className="px-3 py-2">Klant</th>
              <th className="px-3 py-2">FortiGate</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SHA256</th>
              <th className="px-3 py-2">Grootte</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.id} className="border-t border-border">
                <td className="px-3 py-2">{backup.createdAt.toLocaleString("nl-NL")}</td>
                <td className="px-3 py-2">{backup.fortigate.customer.name}</td>
                <td className="px-3 py-2">{backup.fortigate.hostname ?? backup.fortigate.managementUrl}</td>
                <td className="px-3 py-2">
                  <Badge tone={backup.status === "FAILED" ? "danger" : backup.status === "CHANGED" ? "warning" : "success"}>
                    {backup.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{backup.sha256 ?? backup.error ?? "-"}</td>
                <td className="px-3 py-2">{backup.filesize}</td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename ? (
                    <>
                      <ActionLink href={`/api/backups/${backup.id}/download`}>Download</ActionLink>
                      <ActionLink href={`/backups/${backup.id}/diff`}>Diff</ActionLink>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Geen bestand</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}
