import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { ActionLink, Badge, Button, FilterBar, PageHeader, Shell, TableShell } from "@/components/ui";
import { requireContextPermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { mainTenantId } from "@/lib/tenant-main";
import { getTenantTimeZone } from "@/lib/tenant-timezone";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

type AuditMetadata = {
  auditSchemaVersion?: number;
  actorName?: string;
  actorEmail?: string;
  actorType?: string;
  outcome?: "success" | "failure" | "denied";
  reason?: string;
  [key: string]: unknown;
};

export default async function AuditPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireContextPermission({
    global: "platform.audit.read",
    tenant: "audit.read"
  });
  const queryParams = await searchParams;
  const query = firstQueryValue(queryParams.q);
  const action = firstQueryValue(queryParams.action);
  const requestedPage = parsePageParam(queryParams.page);
  const globalTenantId = await mainTenantId();
  const activeTenantId = user.activeTenantId ?? user.tenantId ?? globalTenantId ?? "";
  const auditWhere = {
    tenantId: activeTenantId,
    ...(action ? { action } : {}),
    ...(query
      ? {
          OR: [
            { action: { contains: query } },
            { entity: { contains: query } },
            { entityId: { contains: query } },
            { tenantName: { contains: query } },
            { actorId: { contains: query } },
            { actorName: { contains: query } },
            { actorEmail: { contains: query } },
            { metadata: { contains: query } },
            { user: { is: { OR: [{ name: { contains: query } }, { email: { contains: query } }] } } }
          ]
        }
      : {})
  };
  const totalLogs = await prisma.auditLog.count({ where: auditWhere });
  const page = normalizePage(requestedPage, totalLogs, PAGE_SIZE);
  const [tenant, logs, timeZone, actions] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: activeTenantId }, select: { name: true } }),
    prisma.auditLog.findMany({
      where: auditWhere,
      include: {
        user: { select: { name: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    getTenantTimeZone(activeTenantId),
    prisma.auditLog.findMany({
      where: { tenantId: activeTenantId },
      distinct: ["action"],
      orderBy: { action: "asc" },
      select: { action: true },
      take: 100
    })
  ]);

  return (
    <Shell>
      <PageHeader
        title="Auditlog"
        description={`Auditregels voor ${tenant?.name ?? "de actieve tenant"}. Andere tenants worden hier nooit getoond.`}
      />
      <FilterBar><form className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(220px,0.6fr)_auto_auto] md:items-end" method="get">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Zoeken</span>
          <input
            className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            defaultValue={query}
            name="q"
            placeholder="Actor, actie, object of detail"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Actie</span>
          <select className="min-h-11 rounded-md border border-border bg-surface px-3 py-2" defaultValue={action} name="action">
            <option value="">Alle acties</option>
            {actions.map((item) => <option key={item.action} value={item.action}>{labelForAction(item.action)}</option>)}
          </select>
        </label>
        <Button variant="secondary">Filteren</Button>
        {query || action ? <ActionLink href="/audit">Filters wissen</ActionLink> : <span />}
      </form></FilterBar>
      <TableShell>
        <table className="table-pro w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Tijd</th>
              <th className="px-3 py-2">Wie</th>
              <th className="px-3 py-2">Actie</th>
              <th className="px-3 py-2">Uitkomst</th>
              <th className="px-3 py-2">Object</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const metadata = parseMetadata(log.metadata);
              const actorName = log.actorName ?? log.user?.name ?? metadata.actorName ?? "Systeem";
              const actorEmail = log.actorEmail ?? log.user?.email ?? metadata.actorEmail;
              const outcome = normalizeOutcome(log.outcome, log.action);
              return (
                <tr key={log.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{formatDateTime(log.createdAt, timeZone)}</div>
                    <div className="text-xs text-muted-foreground">{log.tenantName ?? tenant?.name ?? "Onbekende tenant"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{actorName}</div>
                    <div className="text-xs text-muted-foreground">{actorEmail ?? "Geen gebruiker gekoppeld"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={toneForAction(log.action)}>{labelForAction(log.action)}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">{log.action}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={toneForOutcome(outcome)}>
                      {labelForOutcome(outcome)}
                    </Badge>
                    {metadata.reason ? <div className="mt-1 text-xs text-muted-foreground">{metadata.reason}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <div>{log.entity ?? "-"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{log.entityId ?? "-"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <AuditDetails metadata={metadata} />
                  </td>
                </tr>
              );
            })}
            {!logs.length ? (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>Geen auditregels gevonden.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableShell>
      <ServerPagination
        itemLabel="auditregels"
        page={page}
        pageSize={PAGE_SIZE}
        path="/audit"
        query={{ q: query, action }}
        totalItems={totalLogs}
      />
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
  const entries = Object.entries(metadata).filter(([key]) => ![
    "actorName",
    "actorEmail",
    "actorType",
    "auditSchemaVersion",
    "outcome",
    "reason",
    "target"
  ].includes(key));
  if (!entries.length) return <span className="text-muted-foreground">Geen extra details</span>;
  return (
    <details className="min-w-56 rounded-md border border-border bg-surface-soft px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{entries.length} detailvelden</summary>
      <div className="mt-2 grid gap-1">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 border-t border-border py-2 first:border-t-0 first:pt-0">
            <span className="text-xs font-medium text-muted-foreground">{key}</span>
            <span className="break-all font-mono text-xs">{formatMetadataValue(value)}</span>
          </div>
        ))}
      </div>
    </details>
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
    "backup.unchanged": "Backup ongewijzigd",
    "backup.notification_failed": "Backup notificatie mislukt",
    "backup.autotask_ticket_created": "Autotask ticket aangemaakt",
    "fortigate.created": "FortiGate aangemaakt",
    "fortigate.updated": "FortiGate gewijzigd",
    "fortigate.deleted": "FortiGate verwijderd",
    "permission.denied": "Toegang geweigerd",
    "settings.mail_test.sent": "Mailtest verzonden"
  };
  return labels[action] ?? action.split(".").join(" ");
}

function toneForAction(action: string): "neutral" | "success" | "warning" | "danger" {
  if (action.includes("denied") || action.includes("failed") || action.includes("deleted") || action.includes("deactivated")) return "danger";
  if (action.includes("updated") || action.includes("restored") || action.includes("changed")) return "warning";
  if (action.includes("created") || action.includes("login") || action.includes("exported")) return "success";
  return "neutral";
}

function outcomeForAction(action: string): "success" | "failure" | "denied" {
  if (action.includes("denied")) return "denied";
  if (action.includes("failed") || action.includes("failure")) return "failure";
  return "success";
}

function normalizeOutcome(outcome: string | null, action: string): "success" | "failure" | "denied" {
  if (outcome === "success" || outcome === "failure" || outcome === "denied") return outcome;
  return outcomeForAction(action);
}

function labelForOutcome(outcome: "success" | "failure" | "denied") {
  if (outcome === "denied") return "Geweigerd";
  if (outcome === "failure") return "Mislukt";
  return "Gelukt";
}

function toneForOutcome(outcome: "success" | "failure" | "denied"): "neutral" | "success" | "warning" | "danger" {
  if (outcome === "success") return "success";
  return "danger";
}
