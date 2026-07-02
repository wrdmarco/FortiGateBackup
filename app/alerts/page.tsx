import { ActionLink, Badge, PageHeader, Shell, TableShell } from "@/components/ui";
import { checkFortiOsFirmware } from "@/lib/firmware-check";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { formatDateOnly, formatDateTime } from "@/lib/time";
import { getTenantTimeZoneMap } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

type LicenseInfo = {
  services?: Array<{ name?: string; status?: unknown; expires?: unknown }>;
};

type AlertRow = {
  id: string;
  severity: "danger" | "warning";
  type: string;
  customer: string;
  tenant: string;
  fortigate: string;
  message: string;
  detail: string;
  href: string;
};

export default async function AlertsPage() {
  const user = await requireUser();
  const globalTenantId = await mainTenantId();
  const activeTenantId = isSuperAdmin(user) ? user.activeTenantId ?? globalTenantId ?? "" : user.tenantId ?? "";
  const isGlobalContext = await isGlobalTenantId(activeTenantId);
  const where = { customer: { tenantId: isGlobalContext ? "__global_has_no_alerts__" : activeTenantId } };
  const devices = await prisma.fortiGate.findMany({
    where,
    include: {
      customer: { include: { tenant: true } },
      logs: { orderBy: { createdAt: "desc" }, take: 1 },
      backups: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { updatedAt: "desc" }
  });

  const firmwareChecks = await Promise.all(
    devices.map(async (device) => ({ deviceId: device.id, result: await checkFortiOsFirmware(device.firmwareVersion) }))
  );
  const firmwareByDevice = new Map(firmwareChecks.map((item) => [item.deviceId, item.result]));
  const timeZones = await getTenantTimeZoneMap(devices.map((device) => device.customer.tenantId));

  const alerts = devices.flatMap((device): AlertRow[] => {
    const timeZone = timeZones.get(device.customer.tenantId);
    const label = device.hostname ?? device.serialNumber ?? device.managementUrl;
    const base = {
      customer: device.customer.name,
      tenant: device.customer.tenant.name,
      fortigate: label,
      href: `/fortigates?info=${device.id}`
    };
    const rows: AlertRow[] = [];
    const firmware = firmwareByDevice.get(device.id);
    if (firmware?.status === "update-available") {
      rows.push({
        ...base,
        id: `${device.id}-firmware`,
        severity: "warning",
        type: "Oude firmware",
        message: `FortiOS ${firmware.latestVersion} is beschikbaar`,
        detail: `Geinstalleerd: ${firmware.installedVersion ?? "onbekend"}. Branch: ${firmware.branch ?? "onbekend"}.`
      });
    }
    if (!device.firmwareVersion) {
      rows.push({
        ...base,
        id: `${device.id}-firmware-missing`,
        severity: "warning",
        type: "Firmware onbekend",
        message: "Firmwareversie is nog niet uitgelezen",
        detail: "Start een inventory of backup om firmware en buildnummer op te halen."
      });
    }

    for (const license of licenseAlerts(device.licenseInfo, timeZone)) {
      rows.push({
        ...base,
        id: `${device.id}-license-${license.name}`,
        severity: license.expired ? "danger" : "warning",
        type: license.expired ? "Licentie verlopen" : "Licentie verloopt binnenkort",
        message: license.name,
        detail: license.detail
      });
    }

    const latestBackup = device.backups[0];
    if (latestBackup?.status === "FAILED") {
      rows.push({
        ...base,
        id: `${device.id}-backup-failed`,
        severity: "danger",
        type: "Backup fout",
        message: latestBackup.error ?? "Laatste backup is mislukt",
        detail: formatDateTime(latestBackup.createdAt, timeZone)
      });
    }
    return rows;
  });

  return (
    <Shell>
      <PageHeader
        title="Alerts"
        description="Actieve meldingen op basis van echte inventory, firmware-checks, licenties en backupresultaten."
        actions={<ActionLink href="/fortigates" variant="secondary">FortiGates beheren</ActionLink>}
      />
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Metric label="Kritiek" value={alerts.filter((item) => item.severity === "danger").length} tone="danger" />
        <Metric label="Waarschuwingen" value={alerts.filter((item) => item.severity === "warning").length} tone="warning" />
        <Metric label="FortiGates gecontroleerd" value={devices.length} tone="neutral" />
      </div>
      <TableShell>
        <table className="table-pro w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Klant</th>
              <th className="px-3 py-2">FortiGate</th>
              <th className="px-3 py-2">Melding</th>
              <th className="px-3 py-2">Actie</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length ? alerts.map((alert) => (
              <tr key={alert.id} className="border-t border-border align-top">
                <td className="px-3 py-2"><Badge tone={alert.severity}>{alert.severity === "danger" ? "Kritiek" : "Let op"}</Badge></td>
                <td className="px-3 py-2 font-medium">{alert.type}</td>
                <td className="px-3 py-2">{alert.tenant}</td>
                <td className="px-3 py-2">{alert.customer}</td>
                <td className="px-3 py-2">{alert.fortigate}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{alert.message}</div>
                  <div className="text-xs text-muted-foreground">{alert.detail}</div>
                </td>
                <td className="px-3 py-2"><ActionLink href={alert.href} variant="secondary">Open</ActionLink></td>
              </tr>
            )) : (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>Geen actieve alerts gevonden.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "danger" | "warning" | "neutral" }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <Badge tone={tone}>{tone === "danger" ? "Kritiek" : tone === "warning" ? "Review" : "Info"}</Badge>
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </section>
  );
}

function licenseAlerts(raw: string | null, timeZone?: string) {
  const info = parseJson<LicenseInfo | null>(raw, null);
  const now = Date.now();
  const soon = now + 1000 * 60 * 60 * 24 * 30;
  return (info?.services ?? []).flatMap((service) => {
    const name = humanize(String(service.name ?? "Licentie"));
    const status = String(service.status ?? "").toLowerCase();
    const expires = parseLicenseDate(service.expires);
    const expired = status.includes("expired") || status.includes("inactive") || Boolean(expires && expires.getTime() < now);
    const expiringSoon = Boolean(expires && expires.getTime() >= now && expires.getTime() <= soon);
    if (!expired && !expiringSoon) return [];
    return [{
      name,
      expired,
      detail: expires
        ? `Status: ${service.status ?? "onbekend"}. Verloopt: ${formatDateOnly(expires, timeZone)}.`
        : `Status: ${service.status ?? "onbekend"}. Geen vervaldatum uitgelezen.`
    }];
  });
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseLicenseDate(value: unknown) {
  if (!value) return null;
  if (typeof value === "number") {
    const timestamp = value > 100000000000 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw || raw === "0") return null;
  if (/^\d+$/.test(raw)) return parseLicenseDate(Number(raw));
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function humanize(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
