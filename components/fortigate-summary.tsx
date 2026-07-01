import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/time";

type FortiGateSummaryDevice = {
  hostname: string | null;
  serialNumber: string | null;
  model: string | null;
  firmwareVersion: string | null;
  firmwareBuild: string | null;
  uptime: string | null;
  managementUrl: string;
  httpsPort: number;
  tlsVerify: boolean;
  vdom: string | null;
  scheduleType: string;
  cronExpression: string | null;
  nextRunAt: Date | null;
  lastCheckedAt: Date | null;
  active: boolean;
  externalIpAddresses?: string | null;
  licenseInfo?: string | null;
  backups: Array<{
    status: string;
    filename: string | null;
    sha256: string | null;
    filesize: number;
    error: string | null;
    createdAt: Date;
  }>;
  logs: Array<{
    level: string;
    event: string;
    message: string;
    createdAt: Date;
  }>;
};

type ExternalIp = {
  interface?: string;
  address?: string;
};

type LicenseInfo = {
  summary?: Record<string, unknown>;
  services?: Array<{ name?: string; status?: unknown; expires?: unknown }>;
};

export function FortiGateSummary({ device, timeZone }: { device: FortiGateSummaryDevice; timeZone?: string }) {
  const latestBackup = device.backups[0];
  const latestLog = device.logs[0];
  const externalIps = parseJson<ExternalIp[]>(device.externalIpAddresses, []);
  const licenseInfo = parseJson<LicenseInfo | null>(device.licenseInfo, null);
  const firmware = [device.firmwareVersion, device.firmwareBuild ? `build ${device.firmwareBuild}` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label="Hostname" value={device.hostname ?? "Niet uitgelezen"} />
        <SummaryTile label="Model" value={device.model ?? "Niet uitgelezen"} />
        <SummaryTile label="Status" value={device.active ? "Actief" : "Inactief"} tone={device.active ? "success" : "danger"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-surface-soft p-4">
          <h3 className="font-semibold">Identiteit en firmware</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <InfoRow label="Serial" value={device.serialNumber ?? "Niet uitgelezen"} />
            <InfoRow label="Firmware" value={firmware || "Niet uitgelezen"} />
            <InfoRow label="Uptime" value={device.uptime ?? "Niet uitgelezen"} />
            <InfoRow label="Laatste inventory" value={formatDate(device.lastCheckedAt, timeZone)} />
          </dl>
        </section>

        <section className="rounded-md border border-border bg-surface-soft p-4">
          <h3 className="font-semibold">Bereikbaarheid</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <InfoRow label="Management" value={`${device.managementUrl}:${device.httpsPort}`} />
            <InfoRow label="VDOM" value={device.vdom ?? "Global"} />
            <InfoRow label="TLS verify" value={device.tlsVerify ? "Aan" : "Uit"} />
            <InfoRow label="Externe IP's" value={externalIps.length ? externalIps.map(formatExternalIp).join(", ") : "Niet uitgelezen"} />
          </dl>
        </section>
      </div>

      <section className="rounded-md border border-border bg-surface-soft p-4">
        <h3 className="font-semibold">Licentie summary</h3>
        {licenseInfo ? (
          <div className="mt-3 grid gap-3 text-sm">
            {licenseInfo.summary && Object.keys(licenseInfo.summary).length ? (
              <dl className="grid gap-2 md:grid-cols-2">
                {Object.entries(licenseInfo.summary).map(([key, value]) => (
                  <InfoRow key={key} label={humanize(key)} value={formatUnknown(value)} />
                ))}
              </dl>
            ) : null}
            {licenseInfo.services?.length ? (
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Service</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Verloopt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {licenseInfo.services.map((service, index) => (
                      <tr key={`${service.name ?? "service"}-${index}`} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{humanize(String(service.name ?? "Service"))}</td>
                        <td className="px-3 py-2">{formatUnknown(service.status)}</td>
                        <td className="px-3 py-2">{formatUnknown(service.expires)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Licentie-informatie is nog niet uitgelezen. Start een inventory of backup om dit FortiGate endpoint te vullen.
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-surface-soft p-4">
          <h3 className="font-semibold">Backup summary</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <InfoRow label="Schema" value={device.scheduleType === "CRON" ? device.cronExpression ?? "Cron" : device.scheduleType} />
            <InfoRow label="Volgende run" value={formatDate(device.nextRunAt, timeZone)} />
            <InfoRow label="Laatste status" value={latestBackup?.status ?? "Nog niet uitgevoerd"} />
            <InfoRow label="Laatste bestand" value={latestBackup?.filename ? `${latestBackup.filesize} bytes` : latestBackup?.error ?? "Geen bestand"} />
          </dl>
        </section>

        <section className="rounded-md border border-border bg-surface-soft p-4">
          <h3 className="font-semibold">Laatste diagnose</h3>
          {latestLog ? (
            <div className="mt-3 grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={latestLog.level === "ERROR" ? "danger" : latestLog.level === "WARN" ? "warning" : "success"}>
                  {latestLog.level}
                </Badge>
                <span className="font-medium">{latestLog.event}</span>
              </div>
              <p className="text-muted-foreground">{latestLog.message}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(latestLog.createdAt, timeZone)}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nog geen logregels.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="mt-2 text-lg font-semibold">{tone ? <Badge tone={tone}>{value}</Badge> : value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatExternalIp(item: ExternalIp) {
  return [item.interface, item.address].filter(Boolean).join(" ") || "Onbekend";
}

function formatDate(value: Date | null, timeZone?: string) {
  return value ? formatDateTime(value, timeZone) : "Niet gepland";
}

function formatUnknown(value: unknown) {
  if (value === null || value === undefined || value === "") return "Onbekend";
  if (value instanceof Date) return formatDateTime(value);
  return String(value);
}

function humanize(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
