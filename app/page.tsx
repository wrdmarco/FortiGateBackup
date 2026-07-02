import { BackupStatus } from "@prisma/client";
import { ActionLink, Badge, Card, PageHeader, Shell, TableShell } from "@/components/ui";
import { getAppUpdateStatus } from "@/lib/app-update";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const canManagePlatform = isSuperAdmin(user);
  const globalTenantId = await mainTenantId();
  const tenantId = canManagePlatform ? user.activeTenantId ?? globalTenantId ?? undefined : user.tenantId ?? undefined;
  const isGlobalContext = await isGlobalTenantId(tenantId);
  const canReadUpdates = isGlobalContext && (await hasPermission(user, "platform.updates.read"));
  const timeZone = await getTenantTimeZone(tenantId);
  const customerWhere = tenantId && !isGlobalContext ? { tenantId } : { tenantId: "__global_has_no_customers__" };
  const fortigateWhere = tenantId && !isGlobalContext ? { customer: { tenantId } } : { customer: { tenantId: "__global_has_no_fortigates__" } };
  const backupWhere = tenantId && !isGlobalContext ? { fortigate: { customer: { tenantId } } } : { fortigate: { customer: { tenantId: "__global_has_no_backups__" } } };
  const auditWhere = tenantId ? { tenantId } : {};
  const [tenants, customers, fortigates, backups, failures, latestAudit, changed, updateStatus] = await Promise.all([
    canManagePlatform ? prisma.tenant.count() : Promise.resolve(1),
    prisma.customer.count({ where: customerWhere }),
    prisma.fortiGate.count({ where: fortigateWhere }),
    prisma.backup.count({ where: backupWhere }),
    prisma.backup.count({ where: { ...backupWhere, status: BackupStatus.FAILED } }),
    prisma.auditLog.findMany({
      where: auditWhere,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.backup.count({ where: { ...backupWhere, status: BackupStatus.CHANGED } }),
    canReadUpdates ? getAppUpdateStatus() : Promise.resolve(null)
  ]);

  return (
    <Shell>
      <PageHeader
        title="Dashboard"
        description={isGlobalContext ? "Platformstatus, tenants, updates en Global audit." : "Tenantstatus van FortiGates, backups en alerts."}
        actions={!isGlobalContext ? <ActionLink href="/alerts" variant="secondary">Alerts bekijken</ActionLink> : null}
      />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card title={canManagePlatform ? "Tenants" : "Tenant"} value={tenants} />
        <Card title="Klanten" value={customers} />
        <Card title="FortiGates" value={fortigates} />
        <Card title="Backups" value={backups} detail={`${changed} gewijzigd`} />
        <Card title="Fouten" value={failures} />
        {canReadUpdates ? (
          <Card
            title="Applicatie"
            value={updateStatus?.updateAvailable ? "Update" : updateStatus?.updateRunning ? "Bezig" : updateStatus?.currentVersion ?? "0.1.5"}
            detail={updateStatus?.updateAvailable ? "Nieuwe GitHub versie beschikbaar" : updateStatus?.updateRunning ? "Update draait" : "Actueel"}
          />
        ) : null}
      </div>

      {updateStatus?.updateAvailable || updateStatus?.updateRunning ? (
        <section className="mt-6 rounded-md border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Applicatie update</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Lokale commit {shortSha(updateStatus.localCommit)} tegenover GitHub {shortSha(updateStatus.remoteCommit)}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={updateStatus.updateRunning ? "warning" : "danger"}>
                {updateStatus.updateRunning ? "Update draait" : "Update beschikbaar"}
              </Badge>
              <ActionLink href="/settings?tab=updates" variant="primary">Naar updateknop</ActionLink>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Recente activiteiten</h2>
        <TableShell>
          <table className="table-pro w-full text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Actie</th>
                <th className="px-3 py-2">Wie</th>
                <th className="px-3 py-2">Entiteit</th>
                <th className="px-3 py-2">Tijd</th>
              </tr>
            </thead>
            <tbody>
              {latestAudit.map((item) => {
                const metadata = parseMetadata(item.metadata);
                return (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2">{item.action}</td>
                    <td className="px-3 py-2">
                      <div>{item.user?.name ?? metadata.actorName ?? "Systeem"}</div>
                      <div className="text-xs text-muted-foreground">{item.user?.email ?? metadata.actorEmail ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2">{item.entity ?? "-"}</td>
                    <td className="px-3 py-2">{formatDateTime(item.createdAt, timeZone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </section>
    </Shell>
  );
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 12) : "onbekend";
}

function parseMetadata(value: string | null) {
  if (!value) return {} as { actorName?: string; actorEmail?: string };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
