import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupStatus, FortiGate, FortiGateLogLevel } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";

type RequestOptions = {
  headers: Record<string, string>;
  method?: "GET" | "POST";
  rejectUnauthorized?: boolean;
};

type BackupAttempt = {
  method: "GET" | "POST";
  endpoint: string;
  scope: "global" | "vdom";
  destination: boolean;
  vdom?: string | null;
};

function baseUrl(device: FortiGate) {
  const url = new URL(device.managementUrl);
  url.port = String(device.httpsPort);
  return url.toString().replace(/\/$/, "");
}

async function writeFortiGateLog(
  fortigateId: string,
  level: FortiGateLogLevel,
  event: string,
  message: string,
  metadata?: unknown
) {
  try {
    await prisma.fortiGateLog.create({
      data: {
        fortigateId,
        level,
        event,
        message,
        metadata: metadata === undefined ? undefined : JSON.stringify(metadata)
      }
    });
  } catch (error) {
    console.warn("FortiGate log kon niet worden opgeslagen.", error);
  }
}

function requestBuffer(url: URL, options: RequestOptions) {
  return new Promise<Response>((resolve, reject) => {
    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        rejectUnauthorized: options.rejectUnauthorized,
        timeout: 30000
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage,
              headers: res.headers as HeadersInit
            })
          );
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`FortiGate API timeout after 30000ms for ${url.pathname}.`));
    });
    req.on("error", reject);
    req.end();
  });
}

function networkErrorMessage(error: unknown, endpoint: string) {
  if (!(error instanceof Error)) return `FortiGate API request failed for ${endpoint}.`;
  const cause = error.cause instanceof Error ? ` Cause: ${error.cause.message}` : "";
  return `FortiGate API request failed for ${endpoint}: ${error.message}.${cause}`;
}

function backupEndpoint(scope: "global" | "vdom", options?: { destination?: boolean; vdom?: string | null }) {
  const query = new URLSearchParams();
  if (options?.destination) query.set("destination", "file");
  query.set("scope", scope);
  if (scope === "vdom" && options?.vdom) {
    query.set("scope", "vdom");
    query.set("vdom", options.vdom);
  }
  return `/api/v2/monitor/system/config/backup?${query.toString()}`;
}

function backupAttempts(device: FortiGate): BackupAttempt[] {
  const scopes: Array<{ scope: "global" | "vdom"; vdom?: string | null }> = device.vdom
    ? [{ scope: "vdom", vdom: device.vdom }, { scope: "global" }]
    : [{ scope: "global" }];
  const attempts: BackupAttempt[] = [];
  for (const { scope, vdom } of scopes) {
    for (const destination of [true, false]) {
      for (const method of ["GET", "POST"] as const) {
        attempts.push({
          method,
          endpoint: backupEndpoint(scope, { destination, vdom }),
          scope,
          destination,
          vdom
        });
      }
    }
  }
  return attempts;
}

function objectValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}
function flattenObjectValues(value: unknown) {
  const flat: Record<string, unknown> = {};
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (flat[key] === undefined && (typeof item === "string" || typeof item === "number")) {
        flat[key] = item;
      }
      if (item && typeof item === "object") visit(item);
    }
  }
  visit(value);
  return flat;
}

function normalizeSystemStatus(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const results = root.results;
  const status =
    Array.isArray(results)
      ? results.find((item) => item && typeof item === "object")
      : results && typeof results === "object"
        ? results
        : root;
  const record = status && typeof status === "object" ? (status as Record<string, unknown>) : {};
  const flat = { ...flattenObjectValues(root), ...flattenObjectValues(record) };
  const keys = Array.from(new Set([...Object.keys(root), ...Object.keys(record), ...Object.keys(flat)])).sort();

  return {
    keys,
    hostname: objectValue(flat, ["hostname", "host_name", "host-name", "name", "system_name"]),
    serialNumber: objectValue(flat, ["serial", "serial_number", "serialNumber", "serial-number", "serial_no", "serialno"]),
    model: objectValue(flat, ["model", "model_name", "model-name", "platform", "platform_name", "platform-name", "hardware_model"]),
    firmwareVersion: normalizeFirmwareVersion(
      objectValue(flat, [
        "version",
        "firmware",
        "firmware_version",
        "firmwareVersion",
        "os_version",
        "osVersion",
        "build_version",
        "fortios_version"
      ])
    ),
    firmwareBuild: normalizeBuild(
      objectValue(flat, ["build", "buildno", "build_number", "build-number", "firmware_build", "firmwareBuild", "mr"])
    ),
    uptime: objectValue(flat, ["uptime", "up_time", "up-time", "system_uptime"])
  };
}


function payloadResults(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return root.results ?? root;
}

function isPublicIpAddress(value: string) {
  const ip = value.split("/")[0];
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

function normalizeExternalIpAddresses(payload: unknown) {
  const results = payloadResults(payload);
  const records = Array.isArray(results)
    ? results.map((item, index) => ({ name: `interface-${index + 1}`, value: item }))
    : results && typeof results === "object"
      ? Object.entries(results as Record<string, unknown>).map(([name, value]) => ({ name, value }))
      : [];

  return records
    .flatMap(({ name, value }) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const candidates = ["ip", "ip_address", "address", "public_ip", "publicIp", "external_ip", "externalIp"]
        .map((key) => record[key])
        .filter((item): item is string => typeof item === "string" && isPublicIpAddress(item));
      return candidates.map((address) => ({ interface: String(record.name ?? record.interface ?? name), address }));
    })
    .filter((item, index, items) => items.findIndex((other) => other.address === item.address) === index);
}

function normalizeLicenseInfo(payload: unknown) {
  const results = payloadResults(payload);
  if (!results || typeof results !== "object") return undefined;
  const record = results as Record<string, unknown>;
  const entries = Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 16);
  const services = Object.entries(record)
    .filter(([, value]) => value && typeof value === "object")
    .slice(0, 12)
    .map(([name, value]) => {
      const service = value as Record<string, unknown>;
      return {
        name,
        status: service.status ?? service.license_status ?? service.contract_status ?? service.type ?? "unknown",
        expires: service.expires ?? service.expiry ?? service.expiration ?? service.end_date ?? null
      };
    });
  return { summary: Object.fromEntries(entries), services };
}

async function fetchOptionalJson(device: FortiGate, endpoint: string, event: string) {
  try {
    const response = await fortigateFetch(device, endpoint);
    return await response.json();
  } catch (error) {
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.WARN,
      event,
      error instanceof Error ? error.message : "Optionele FortiGate inventory endpoint mislukt."
    );
    return undefined;
  }
}
function normalizeFirmwareVersion(value?: string) {
  if (!value) return undefined;
  const match = value.match(/v?(\d+(?:\.\d+){1,3})/i);
  return match?.[1] ?? value;
}

function normalizeBuild(value?: string) {
  if (!value) return undefined;
  const match = value.match(/(?:build)?\s*([0-9]+)/i);
  return match?.[1] ?? value;
}

function parseFirmwareFromConfig(config: Buffer) {
  const header = config.toString("utf8", 0, Math.min(config.byteLength, 4096));
  const configVersion = header.match(/^#config-version=.*?(\d+(?:\.\d+){1,3}).*?(?:FW-)?build([0-9]+)/im);
  const versionLine = header.match(/^#.*?version=.*?v?(\d+(?:\.\d+){1,3})/im);
  const buildLine = header.match(/^#\s*buildno=([0-9]+)/im);
  return {
    firmwareVersion: configVersion?.[1] ?? versionLine?.[1],
    firmwareBuild: configVersion?.[2] ?? buildLine?.[1]
  };
}

async function updateFirmwareFromConfig(device: FortiGate, config: Buffer) {
  const parsed = parseFirmwareFromConfig(config);
  if (!parsed.firmwareVersion && !parsed.firmwareBuild) return device;
  const updated = await prisma.fortiGate.update({
    where: { id: device.id },
    data: {
      firmwareVersion: parsed.firmwareVersion ?? device.firmwareVersion,
      firmwareBuild: parsed.firmwareBuild ?? device.firmwareBuild,
      lastCheckedAt: new Date()
    }
  });
  if (
    updated.firmwareVersion &&
    (updated.firmwareVersion !== device.firmwareVersion ||
      updated.firmwareBuild !== device.firmwareBuild)
  ) {
    await prisma.versionHistory.create({
      data: {
        fortigateId: updated.id,
        firmwareVersion: updated.firmwareVersion,
        firmwareBuild: updated.firmwareBuild
      }
    });
    await writeFortiGateLog(
      updated.id,
      FortiGateLogLevel.INFO,
      "firmware.detected_from_backup",
      "Firmwareversie uit backup header gedetecteerd.",
      {
        firmwareVersion: updated.firmwareVersion,
        firmwareBuild: updated.firmwareBuild
      }
    );
  }
  return updated;
}

async function fortigateFetch(device: FortiGate, endpoint: string, method: "GET" | "POST" = "GET") {
  const token = decryptSecret(device.apiTokenEncrypted);
  const url = new URL(`${baseUrl(device)}${endpoint}`);
  let response: Response;
  try {
    response = await requestBuffer(url, {
      headers: { Authorization: `Bearer ${token}` },
      method,
      rejectUnauthorized: device.tlsVerify
    });
  } catch (error) {
    throw new Error(networkErrorMessage(error, endpoint));
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500).trim();
    throw new Error(
      `FortiGate API returned ${response.status} for ${method} ${endpoint}.${body ? ` Body: ${body}` : ""}`
    );
  }
  return response;
}

async function fetchBackupConfig(device: FortiGate) {
  const failures: string[] = [];
  for (const attempt of backupAttempts(device)) {
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.fetch_config",
      "Configuratie ophalen bij FortiGate.",
      attempt
    );
    try {
      const response = await fortigateFetch(device, attempt.endpoint, attempt.method);
      return {
        attempt,
        config: Buffer.from(await response.arrayBuffer())
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onbekende FortiGate backup fout.";
      failures.push(`${attempt.method} ${attempt.endpoint} -> ${message}`);
      await writeFortiGateLog(
        device.id,
        FortiGateLogLevel.WARN,
        "backup.fetch_config_failed",
        message,
        attempt
      );
    }
  }
  throw new Error(`Alle FortiGate backup endpoint pogingen zijn mislukt. ${failures.join(" | ")}`);
}

export async function refreshFortiGateInventory(deviceId: string) {
  const device = await prisma.fortiGate.findUniqueOrThrow({ where: { id: deviceId } });
  await writeFortiGateLog(
    device.id,
    FortiGateLogLevel.INFO,
    "inventory.start",
    "FortiGate inventory ophalen gestart."
  );
  try {
    const response = await fortigateFetch(device, "/api/v2/monitor/system/status");
    const payload = await response.json();
    const status = normalizeSystemStatus(payload);
    const [interfacePayload, licensePayload] = await Promise.all([
      fetchOptionalJson(device, "/api/v2/monitor/system/interface", "inventory.interfaces_unavailable"),
      fetchOptionalJson(device, "/api/v2/monitor/license/status", "inventory.license_unavailable")
    ]);
    const externalIpAddresses = interfacePayload ? normalizeExternalIpAddresses(interfacePayload) : [];
    const licenseInfo = licensePayload ? normalizeLicenseInfo(licensePayload) : undefined;
    const updated = await prisma.fortiGate.update({
      where: { id: device.id },
      data: {
        hostname: status.hostname ?? device.hostname,
        serialNumber: status.serialNumber ?? device.serialNumber,
        model: status.model ?? device.model,
        firmwareVersion: status.firmwareVersion ?? device.firmwareVersion,
        firmwareBuild: status.firmwareBuild ?? device.firmwareBuild,
        uptime: status.uptime ?? device.uptime,
        externalIpAddresses: externalIpAddresses.length ? JSON.stringify(externalIpAddresses) : device.externalIpAddresses,
        licenseInfo: licenseInfo ? JSON.stringify(licenseInfo) : device.licenseInfo,
        lastCheckedAt: new Date()
      }
    });

    if (
      updated.firmwareVersion &&
      (updated.firmwareVersion !== device.firmwareVersion ||
        updated.firmwareBuild !== device.firmwareBuild)
    ) {
      await prisma.versionHistory.create({
        data: {
          fortigateId: updated.id,
          firmwareVersion: updated.firmwareVersion,
          firmwareBuild: updated.firmwareBuild
        }
      });
      await auditLog({
        action: "firmware.changed",
        entity: "FortiGate",
        entityId: updated.id,
        metadata: {
          from: `${device.firmwareVersion ?? "unknown"} ${device.firmwareBuild ?? ""}`.trim(),
          to: `${updated.firmwareVersion} ${updated.firmwareBuild ?? ""}`.trim()
        }
      });
      await writeFortiGateLog(
        updated.id,
        FortiGateLogLevel.INFO,
        "firmware.changed",
        "Nieuwe firmwareversie gedetecteerd.",
        {
          from: `${device.firmwareVersion ?? "unknown"} ${device.firmwareBuild ?? ""}`.trim(),
          to: `${updated.firmwareVersion} ${updated.firmwareBuild ?? ""}`.trim()
        }
      );
    }

    await writeFortiGateLog(
      updated.id,
      FortiGateLogLevel.INFO,
      "inventory.success",
      "FortiGate inventory succesvol bijgewerkt.",
      {
        hostname: updated.hostname,
        model: updated.model,
        firmwareVersion: updated.firmwareVersion,
        firmwareBuild: updated.firmwareBuild,
        serialNumber: updated.serialNumber,
        externalIpAddresses: externalIpAddresses.length,
        licenseInfo: Boolean(licenseInfo),
        sourceFields: status.keys
      }
    );

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende inventory fout.";
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.ERROR,
      "inventory.failed",
      message
    );
    throw error;
  }
}

export async function runBackup(deviceId: string) {
  const device = await prisma.fortiGate.findUniqueOrThrow({ where: { id: deviceId } });
  try {
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.start",
      "Backup gestart."
    );
    const refreshed = await refreshFortiGateInventory(device.id);
    const { attempt, config } = await fetchBackupConfig(refreshed);
    await updateFirmwareFromConfig(refreshed, config);
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.config_received",
      "Configuratie ontvangen.",
      { bytes: config.byteLength, attempt }
    );
    const digest = sha256(config);
    const latest = await prisma.backup.findFirst({
      where: { fortigateId: device.id, status: BackupStatus.CHANGED },
      orderBy: { createdAt: "desc" }
    });

    if (latest?.sha256 === digest) {
      await writeFortiGateLog(
        device.id,
        FortiGateLogLevel.INFO,
        "backup.unchanged",
        "Backup voltooid; configuratie is ongewijzigd.",
        { sha256: digest, bytes: config.byteLength }
      );
      return prisma.backup.create({
        data: {
          fortigateId: device.id,
          sha256: digest,
          filesize: config.byteLength,
          status: BackupStatus.UNCHANGED
        }
      });
    }

    const directory = path.join(process.cwd(), "data", "backups", device.id);
    await mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${stamp}-${device.hostname ?? device.serialNumber ?? device.id}.conf`;
    const fullPath = path.join(directory, filename);
    await writeFile(fullPath, config);
    await auditLog({
      action: "backup.changed",
      entity: "FortiGate",
      entityId: device.id,
      metadata: { sha256: digest, filename }
    });
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.saved",
      "Backup opgeslagen.",
      { sha256: digest, filename, bytes: config.byteLength }
    );
    return prisma.backup.create({
      data: {
        fortigateId: device.id,
        filename: path.relative(process.cwd(), fullPath),
        sha256: digest,
        filesize: config.byteLength,
        status: BackupStatus.CHANGED
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backup error.";
    await auditLog({
      action: "backup.failed",
      entity: "FortiGate",
      entityId: device.id,
      metadata: { error: message }
    });
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.ERROR,
      "backup.failed",
      message
    );
    return prisma.backup.create({
      data: {
        fortigateId: device.id,
        status: BackupStatus.FAILED,
        error: message
      }
    });
  }
}
