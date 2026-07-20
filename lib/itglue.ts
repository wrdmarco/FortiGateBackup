import path from "node:path";
import { Backup, Customer, FortiGate } from "@prisma/client";
import { fetchPublicHttps, normalizeHttpsServiceBaseUrl, readResponseText } from "@/lib/network-safety";
import { getSetting } from "@/lib/settings";

export type ItGlueUploadTarget = FortiGate & { customer: Customer };

type ItGlueSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string | null;
};

export async function getItGlueSettings(tenantId?: string | null): Promise<ItGlueSettings> {
  const [enabled, baseUrl, apiKey] = await Promise.all([
    getSetting("itglue.enabled", tenantId),
    getSetting("itglue.baseUrl", tenantId),
    getSetting("itglue.apiKey", tenantId)
  ]);
  return {
    enabled: enabled === "true",
    baseUrl: normalizeBaseUrl(baseUrl || "https://api.itglue.com"),
    apiKey
  };
}

export async function isItGlueEnabled(tenantId?: string | null) {
  return (await getItGlueSettings(tenantId)).enabled;
}

export async function uploadBackupToItGlue({
  tenantId,
  device,
  backup,
  config,
  filename
}: {
  tenantId: string;
  device: ItGlueUploadTarget;
  backup: Backup;
  config: Buffer;
  filename: string;
}) {
  const settings = await getItGlueSettings(tenantId);
  if (!settings.enabled) return { skipped: true, reason: "itglue.disabled" };
  if (!settings.apiKey) throw new Error("IT Glue API key ontbreekt.");
  if (!device.customer.itGlueOrganizationId) throw new Error("IT Glue organization ID ontbreekt op de klant.");
  if (!device.itGlueConfigurationId) throw new Error("IT Glue configuration ID ontbreekt op de FortiGate.");
  if (config.byteLength > 64 * 1024 * 1024) throw new Error("IT Glue upload overschrijdt de limiet van 64 MiB.");

  const uploadName = path.basename(filename);
  const response = await fetchPublicHttps(
    `${settings.baseUrl}/attachments`,
    {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "content-type": "application/vnd.api+json",
        accept: "application/vnd.api+json"
      },
      body: JSON.stringify({
        data: {
          type: "attachments",
          attributes: {
            name: uploadName,
            description: `FortiGate backup ${backup.id} - ${new Date().toISOString()}`,
            attachment: config.toString("base64"),
            "resource-type": "configurations",
            "resource-id": device.itGlueConfigurationId,
            "organization-id": device.customer.itGlueOrganizationId
          }
        }
      })
    },
    { timeoutMs: 45_000, maximumBytes: 512 * 1024, maximumRedirects: 2 }
  );

  const body = await readResponseText(response, 512 * 1024);
  if (!response.ok) {
    throw new Error(`IT Glue upload failed with HTTP ${response.status}.${body ? ` Body: ${body.slice(0, 500)}` : ""}`);
  }

  const parsed = parseJsonApi(body);
  return {
    skipped: false,
    attachmentId: parsed?.data?.id ? String(parsed.data.id) : null,
    rawStatus: response.status
  };
}

function normalizeBaseUrl(value: string) {
  return normalizeHttpsServiceBaseUrl(value, "https://api.itglue.com", "IT Glue", ["itglue.com"]);
}

function parseJsonApi(body: string) {
  if (!body) return null;
  try {
    return JSON.parse(body) as { data?: { id?: unknown } };
  } catch {
    return null;
  }
}
