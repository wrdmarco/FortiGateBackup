import { BackupStatus } from "@prisma/client";
import { Card, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const tenantId = isSuperAdmin(user) ? undefined : user.tenantId ?? undefined;
  const customerWhere = tenantId ? { tenantId } : {};
  const fortigateWhere = tenantId ? { customer: { tenantId } } : {};
  const backupWhere = tenantId ? { fortigate: { customer: { tenantId } } } : {};
  const auditWhere = tenantId ? { tenantId } : {};
  const [tenants, customers, fortigates, backups, failures, latestAudit] = await Promise.all([
    isSuperAdmin(user) ? prisma.tenant.count() : Promise.resolve(1),
    prisma.customer.count({ where: customerWhere }),
    prisma.fortiGate.count({ where: fortigateWhere }),
    prisma.backup.count({ where: backupWhere }),
    prisma.backup.count({ where: { ...backupWhere, status: BackupStatus.FAILED } }),
    prisma.auditLog.findMany({ where: auditWhere, orderBy: { createdAt: "desc" }, take: 8 })
  ]);
  const changed = await prisma.backup.count({
    where: { ...backupWhere, status: BackupStatus.CHANGED }
  });

  return (
    <Shell>
      <PageHeader
        title="Dashboard"
        description="Centrale status van tenants, FortiGates, backups en firmwaremeldingen."
      />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card title={isSuperAdmin(user) ? "Tenants" : "Tenant"} value={tenants} />
        <Card title="Klanten" value={customers} />
        <Card title="FortiGates" value={fortigates} />
        <Card title="Backups" value={backups} detail={`${changed} gewijzigd`} />
        <Card title="Fouten" value={failures} />
        <Card title="Versie" value="0.1.2" detail="Applicatie" />
      </div>
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Recente activiteiten</h2>
        <TableShell>
          <table className="table-pro w-full text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Actie</th>
                <th className="px-3 py-2">Entiteit</th>
                <th className="px-3 py-2">Tijd</th>
              </tr>
            </thead>
            <tbody>
              {latestAudit.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-3 py-2">{item.action}</td>
                  <td className="px-3 py-2">{item.entity ?? "-"}</td>
                  <td className="px-3 py-2">{item.createdAt.toLocaleString("nl-NL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </section>
    </Shell>
  );
}
