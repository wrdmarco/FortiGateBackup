import { notFound } from "next/navigation";
import { Badge, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { getTenantTimeZone } from "@/lib/tenant-timezone";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type AuditMetadata = {
  actorName?: string;
  actorEmail?: string;
  [key: string]: unknown;
};

export default async function AuditPage() {
  const user = await requireUser();
  const globalTenantId = await mainTenantId();
  const activeTenantId = isSuperAdmin(user) ? user.activeTenantId ?? globalTenantId ?? "" : user.tenantId ?? "";
  if (!activeTenantId) notFound();

  const isGlobalContext = await isGlobalTenantId(activeTenantId);
  const permission = isSuperAdmin(user) && isGlobalContext ? "platform.audit.read" : "audit.read";
  if (!(await hasPermission(user, permission))) notFound();

  const [tenant, logs, timeZone] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: activeTenantId }, select: { name: true } }),
    prisma.auditLog.findMany({
      where: { tenantId: activeTenantId },
      include: {
        user: { select: { name: true, email: true } },
        tenant: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 250
    }),
    getTenantTimeZone(activeTenantId)
  ]);

  return (
    <Shell>
      <PageHeader
        title="Auditlog"
        description={`Auditregels voor ${tenant?.name ?? "de actieve tenant"}. Andere tenants worden hier nooit getoond.`}
      />
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Tijd</th>
              <th className="px-3 py-2">Wie</th>
              <th className="px-3 py-2">Actie</th>
              <th className="px-3 py-2">Object</th>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const metadata = parseMetadata(log.metadata);
              const actorName = log.user?.name ?? metadata.actorName ?? "Systeem";
              const actorEmail = log.user?.email ?? metadata.actorEmail;
              return (
                <tr key={log.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(log.createdAt, timeZone)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{actorName}</div>
                    <div className="text-xs text-muted-foreground">{actorEmail ?? "Geen gebruiker gekoppeld"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={toneForAction(log.action)}>{labelForAction(log.action)}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">{log.action}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{log.entity ?? "-"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{log.entityId ?? "-"}</div>
                  </td>
                  <td className="px-3 py-2">{log.tenant?.name ?? tenant?.name ?? "-"}</td>
                  <td className="px-3 py-2">
                    <AuditDetails metadata={metadata} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}

function parseMetadata(value: string | null): AuditMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}

function AuditDetails({ metadata }: { metadata: AuditMetadata }) {
  const entries = Object.entries(metadata).filter(([key]) => !["actorName", "actorEmail"].includes(key));
  if (!entries.length) return <span className="text-muted-foreground">Geen extra details</span>;
  return (
    <div className="grid gap-1">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="grid gap-1 rounded-md border border-border bg-surface-soft px-2 py-1">
          <span className="text-xs font-medium text-muted-foreground">{key}</span>
          <span className="break-words font-mono text-xs">{formatMetadataValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function labelForAction(action: string) {
  const labels: Record<string, string> = {
    "auth.login": "Login",
    "tenant.created": "Tenant aangemaakt",
    "tenant.deleted": "Tenant verwijderd",
    "tenant.exported": "Tenant backup",
    "tenant.restored": "Tenant restore",
    "settings.updated": "Instellingen",
    "user.created": "Gebruiker aangemaakt",
    "user.updated": "Gebruiker gewijzigd",
    "user.deleted": "Gebruiker verwijderd",
    "backup.changed": "Backup gewijzigd",
    "backup.failed": "Backup mislukt",
    "fortigate.created": "FortiGate aangemaakt",
    "fortigate.updated": "FortiGate gewijzigd",
    "fortigate.deleted": "FortiGate verwijderd"
  };
  return labels[action] ?? action.split(".").join(" ");
}

function toneForAction(action: string): "neutral" | "success" | "warning" | "danger" {
  if (action.includes("failed") || action.includes("deleted") || action.includes("deactivated")) return "danger";
  if (action.includes("updated") || action.includes("restored") || action.includes("changed")) return "warning";
  if (action.includes("created") || action.includes("login") || action.includes("exported")) return "success";
  return "neutral";
}
