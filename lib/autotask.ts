import { Backup, Customer, FortiGate } from "@prisma/client";
import { getSetting } from "@/lib/settings";

export type AutotaskTicketTarget = FortiGate & { customer: Customer };

type AutotaskSettings = {
  enabled: boolean;
  baseUrl: string;
  integrationCode: string | null;
  username: string | null;
  secret: string | null;
  queueId: string | null;
  priorityId: string | null;
  workTypeId: string | null;
  statusId: string | null;
  sourceId: string | null;
  issueTypeId: string | null;
  subIssueTypeId: string | null;
};

type CreateTicketInput = {
  tenantId: string;
  device: AutotaskTicketTarget;
  backup: Backup;
};

export async function getAutotaskSettings(tenantId?: string | null): Promise<AutotaskSettings> {
  const [
    enabled,
    baseUrl,
    integrationCode,
    username,
    secret,
    queueId,
    priorityId,
    workTypeId,
    statusId,
    sourceId,
    issueTypeId,
    subIssueTypeId
  ] = await Promise.all([
    getSetting("autotask.enabled", tenantId),
    getSetting("autotask.baseUrl", tenantId),
    getSetting("autotask.integrationCode", tenantId),
    getSetting("autotask.username", tenantId),
    getSetting("autotask.secret", tenantId),
    getSetting("autotask.queueId", tenantId),
    getSetting("autotask.priorityId", tenantId),
    getSetting("autotask.workTypeId", tenantId),
    getSetting("autotask.statusId", tenantId),
    getSetting("autotask.sourceId", tenantId),
    getSetting("autotask.issueTypeId", tenantId),
    getSetting("autotask.subIssueTypeId", tenantId)
  ]);
  return {
    enabled: enabled === "true",
    baseUrl: normalizeBaseUrl(baseUrl || "https://webservices.autotask.net/atservicesrest/v1.0"),
    integrationCode,
    username,
    secret,
    queueId,
    priorityId,
    workTypeId,
    statusId,
    sourceId,
    issueTypeId,
    subIssueTypeId
  };
}

export async function isAutotaskEnabled(tenantId?: string | null) {
  return (await getAutotaskSettings(tenantId)).enabled;
}

export async function createAutotaskBackupTicket({ tenantId, device, backup }: CreateTicketInput) {
  const settings = await getAutotaskSettings(tenantId);
  if (!settings.enabled) return { skipped: true, reason: "autotask.disabled" };
  if (!settings.integrationCode || !settings.username || !settings.secret) {
    throw new Error("Autotask API gegevens ontbreken.");
  }
  if (!device.customer.autotaskCompanyId) {
    throw new Error("Autotask Company ID ontbreekt op de klant.");
  }
  if (!settings.queueId || !settings.priorityId) {
    throw new Error("Autotask queue en priority zijn verplicht voor backup tickets.");
  }

  const body = compactObject({
    companyID: numberValue(device.customer.autotaskCompanyId),
    title: `${backup.status === "FAILED" ? "FortiGate backup mislukt" : "FortiGate backup rapport"} - ${
      device.hostname ?? device.managementUrl
    }`,
    description: ticketDescription(device, backup),
    queueID: numberValue(settings.queueId),
    priority: numberValue(settings.priorityId),
    status: numberValue(settings.statusId),
    source: numberValue(settings.sourceId),
    issueType: numberValue(settings.issueTypeId),
    subIssueType: numberValue(settings.subIssueTypeId),
    workTypeID: numberValue(settings.workTypeId)
  });

  const response = await fetch(`${settings.baseUrl}/Tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ApiIntegrationCode: settings.integrationCode,
      UserName: settings.username,
      Secret: settings.secret
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Autotask ticket aanmaken mislukt met HTTP ${response.status}.${text ? ` Body: ${text.slice(0, 500)}` : ""}`);
  }

  const parsed = parseAutotaskResponse(text);
  return {
    skipped: false,
    ticketId: parsed.itemId ?? parsed.id ?? parsed.item?.id ?? null,
    rawStatus: response.status
  };
}

function ticketDescription(device: AutotaskTicketTarget, backup: Backup) {
  return [
    `Klant: ${device.customer.name}`,
    `FortiGate: ${device.hostname ?? device.managementUrl}`,
    `Management URL: ${device.managementUrl}:${device.httpsPort}`,
    `Serienummer: ${device.serialNumber ?? "Onbekend"}`,
    `Status: ${backup.status}`,
    `Backup ID: ${backup.id}`,
    `Tijdstip: ${backup.createdAt.toISOString()}`,
    `Bestandsgrootte: ${backup.filesize} bytes`,
    backup.sha256 ? `SHA256: ${backup.sha256}` : null,
    backup.error ? `Fout: ${backup.error}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "https://webservices.autotask.net/atservicesrest/v1.0";
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function numberValue(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")) as Partial<T>;
}

function parseAutotaskResponse(body: string) {
  if (!body) return {} as { itemId?: string | number; id?: string | number; item?: { id?: string | number } };
  try {
    return JSON.parse(body) as { itemId?: string | number; id?: string | number; item?: { id?: string | number } };
  } catch {
    return {};
  }
}
