import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type DetailedPeerCertificate, type TLSSocket } from "node:tls";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Backup, BackupStatus, FortiGate, FortiGateLogLevel } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { notifyBackupResult } from "@/lib/backup-notifications";
import { applyBackupRetention } from "@/lib/backup-retention";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { artifactRelativePath, writeImmutableArtifact } from "@/lib/security/artifact-storage";
import { FORTIOS_PARSER_VERSION } from "@/lib/security/fortios-parser";
import { tenantTransaction } from "@/lib/tenant-db";
import { prisma } from "@/lib/db";
import { uploadBackupToItGlue } from "@/lib/itglue";
import {
  normalizeFortiGateBaseUrl,
  pinnedLookup,
  resolveAllowedFortiGateAddress,
  safeFilenameSegment
} from "@/lib/network-safety";

const FORTIGATE_REQUEST_TIMEOUT_MS = 30_000;
const FORTIGATE_JSON_LIMIT_BYTES = 4 * 1024 * 1024;
const FORTIGATE_CONFIG_LIMIT_BYTES = 64 * 1024 * 1024;
const BACKUP_LOCK_STALE_MS = 30 * 60 * 1000;
const inFlightBackups = new Map<string, Promise<Backup>>();

type RequestOptions = {
  headers: Record<string, string>;
  method?: "GET" | "POST";
  maximumBytes: number;
  certificateFingerprint?: string | null;
};

type BackupAttempt = {
  method: "GET" | "POST";
  endpoint: string;
  scope: "global" | "vdom";
  destination: boolean;
  vdom?: string | null;
};

type FortiGateConnection = Pick<
  FortiGate,
  "managementUrl" | "httpsPort" | "tlsVerify" | "tlsCertificateFingerprint" | "apiTokenEncrypted"
>;

export type FortiGateCertificateInspection = {
  fingerprint: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  trusted: boolean;
  selfSigned: boolean;
  validationError: string | null;
};

function baseUrl(device: FortiGateConnection) {
  const url = normalizeFortiGateBaseUrl(device.managementUrl, device.httpsPort, device.tlsVerify);
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

async function requestBuffer(url: URL, options: RequestOptions) {
  const resolvedAddress = await resolveAllowedFortiGateAddress(url.hostname);
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      reject(error);
    };
    const pinnedFingerprint = normalizeFingerprint(options.certificateFingerprint);
    const req = httpsRequest(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        agent: false,
        rejectUnauthorized: !pinnedFingerprint,
        lookup: pinnedLookup(resolvedAddress.address, resolvedAddress.family),
        timeout: FORTIGATE_REQUEST_TIMEOUT_MS
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const declaredLength = Number(res.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > options.maximumBytes) {
          res.destroy(new Error(`FortiGate respons overschrijdt de limiet van ${options.maximumBytes} bytes.`));
          return;
        }
        res.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > options.maximumBytes) {
            res.destroy(new Error(`FortiGate respons overschrijdt de limiet van ${options.maximumBytes} bytes.`));
            return;
          }
          chunks.push(buffer);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(overallTimeout);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage,
              headers: res.headers as HeadersInit
            })
          );
        });
        res.on("error", finishWithError);
        res.on("aborted", () => finishWithError(new Error("FortiGate heeft de respons voortijdig afgebroken.")));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`FortiGate API timeout na ${FORTIGATE_REQUEST_TIMEOUT_MS} ms voor ${url.pathname}.`));
    });
    req.on("error", finishWithError);
    if (pinnedFingerprint) {
      req.on("socket", (socket) => {
        const tlsSocket = socket as TLSSocket;
        tlsSocket.once("secureConnect", () => {
          const certificate = tlsSocket.getPeerCertificate(true) as DetailedPeerCertificate;
          const actualFingerprint = peerCertificateFingerprint(certificate);
          if (!actualFingerprint) {
            req.destroy(new Error("De FortiGate TLS-verbinding leverde geen controleerbaar leaf-certificaat op."));
            return;
          }
          if (!certificateFingerprintMatches(pinnedFingerprint, actualFingerprint)) {
            req.destroy(new Error("Het FortiGate TLS-certificaat is gewijzigd en moet opnieuw expliciet worden geaccepteerd."));
            return;
          }
          req.end();
        });
      });
    }
    const overallTimeout = setTimeout(() => {
      req.destroy(new Error(`FortiGate API timeout na ${FORTIGATE_REQUEST_TIMEOUT_MS} ms voor ${url.pathname}.`));
    }, FORTIGATE_REQUEST_TIMEOUT_MS);
    overallTimeout.unref();
    if (!pinnedFingerprint) req.end();
  });
}

function normalizeFingerprint(value?: string | null) {
  return value?.replace(/[^a-fA-F0-9]/g, "").toUpperCase() || null;
}

export function peerCertificateFingerprint(certificate: Pick<DetailedPeerCertificate, "fingerprint256" | "raw">) {
  if (certificate.raw?.length) return normalizeFingerprint(sha256(certificate.raw));
  return normalizeFingerprint(certificate.fingerprint256);
}

export function certificateFingerprintMatches(expected?: string | null, actual?: string | null) {
  const normalizedExpected = normalizeFingerprint(expected);
  const normalizedActual = normalizeFingerprint(actual);
  return Boolean(normalizedExpected && normalizedActual && normalizedExpected === normalizedActual);
}

function certificateName(value: DetailedPeerCertificate["subject"] | DetailedPeerCertificate["issuer"]) {
  if (!value) return "Onbekend";
  const commonName = value.CN;
  if (Array.isArray(commonName)) return commonName.join(", ");
  if (commonName) return commonName;
  return Object.entries(value)
    .map(([key, item]) => `${key}=${Array.isArray(item) ? item.join(", ") : item}`)
    .join(", ") || "Onbekend";
}

export async function inspectFortiGateCertificate(
  managementUrl: string,
  httpsPort: number
): Promise<FortiGateCertificateInspection> {
  const url = normalizeFortiGateBaseUrl(managementUrl, httpsPort, true);
  const resolvedAddress = await resolveAllowedFortiGateAddress(url.hostname);

  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: url.hostname,
      port: Number(url.port || httpsPort),
      servername: isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: false,
      lookup: pinnedLookup(resolvedAddress.address, resolvedAddress.family),
      minVersion: "TLSv1.2"
    });
    const timeout = setTimeout(() => socket.destroy(new Error("Timeout tijdens TLS-certificaatcontrole.")), FORTIGATE_REQUEST_TIMEOUT_MS);
    timeout.unref();
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      const certificate = socket.getPeerCertificate(true) as DetailedPeerCertificate;
      const fingerprint = peerCertificateFingerprint(certificate);
      if (!certificate.raw || !fingerprint) {
        socket.destroy();
        reject(new Error("De FortiGate presenteerde geen bruikbaar TLS-certificaat."));
        return;
      }
      const issuerFingerprint = normalizeFingerprint(certificate.issuerCertificate?.fingerprint256);
      const subject = certificateName(certificate.subject);
      const issuer = certificateName(certificate.issuer);
      const result: FortiGateCertificateInspection = {
        fingerprint,
        subject,
        issuer,
        validFrom: new Date(certificate.valid_from).toISOString(),
        validTo: new Date(certificate.valid_to).toISOString(),
        trusted: socket.authorized,
        selfSigned: issuerFingerprint === fingerprint || subject === issuer,
        validationError: socket.authorized ? null : String(socket.authorizationError || "Certificaat niet vertrouwd")
      };
      socket.end();
      resolve(result);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
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

export function backupMethodsForFirmware(firmwareVersion?: string | null): Array<"GET" | "POST"> {
  const match = firmwareVersion?.match(/^v?(\d+)\.(\d+)/i);
  if (!match) return ["POST", "GET"];
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 7 || (major === 7 && minor >= 6) ? ["POST", "GET"] : ["GET", "POST"];
}

function backupAttempts(device: FortiGate): BackupAttempt[] {
  const scopes: Array<{ scope: "global" | "vdom"; vdom?: string | null }> = device.vdom
    ? [{ scope: "vdom", vdom: device.vdom }, { scope: "global" }]
    : [{ scope: "global" }];
  const attempts: BackupAttempt[] = [];
  for (const { scope, vdom } of scopes) {
    for (const destination of [true, false]) {
      for (const method of backupMethodsForFirmware(device.firmwareVersion)) {
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

async function fortigateFetch(
  device: FortiGateConnection,
  endpoint: string,
  method: "GET" | "POST" = "GET",
  maximumBytes = FORTIGATE_JSON_LIMIT_BYTES
) {
  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) {
    throw new Error("FortiGate API-endpoint moet een lokaal absoluut pad zijn.");
  }
  const token = decryptSecret(device.apiTokenEncrypted);
  const safeBaseUrl = baseUrl(device);
  const url = new URL(endpoint, `${safeBaseUrl}/`);
  if (url.origin !== new URL(safeBaseUrl).origin) throw new Error("FortiGate API-endpoint wijst buiten de managementhost.");
  let response: Response;
  try {
    response = await requestBuffer(url, {
      headers: { Authorization: `Bearer ${token}` },
      method,
      maximumBytes,
      certificateFingerprint: device.tlsCertificateFingerprint
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

export async function probeFortiGateConnection(device: FortiGateConnection) {
  const response = await fortigateFetch(device, "/api/v2/monitor/system/status");
  return normalizeSystemStatus(await response.json());
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
      const response = await fortigateFetch(device, attempt.endpoint, attempt.method, FORTIGATE_CONFIG_LIMIT_BYTES);
      return {
        attempt,
        config: Buffer.from(await response.arrayBuffer())
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onbekende FortiGate backup fout.";
      failures.push(`${attempt.method} ${attempt.endpoint} -> ${message}`);
      await writeFortiGateLog(
        device.id,
        FortiGateLogLevel.INFO,
        "backup.fetch_config_fallback",
        `Backupvariant niet ondersteund; volgende compatibiliteitsvariant wordt geprobeerd. ${message}`,
        attempt
      );
    }
  }
  throw new Error(`Alle FortiGate backup endpoint pogingen zijn mislukt. ${failures.join(" | ")}`);
}

export async function refreshFortiGateInventory(deviceId: string) {
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id: deviceId },
    include: { customer: { select: { tenantId: true } } }
  });
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
        tenantId: device.customer.tenantId,
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

export class BackupAlreadyRunningError extends Error {
  constructor(deviceId: string) {
    super(`Er draait al een backup voor FortiGate ${deviceId}.`);
    this.name = "BackupAlreadyRunningError";
  }
}

export function runBackup(deviceId: string, options: { notifyResult?: boolean } = {}): Promise<Backup> {
  const existing = inFlightBackups.get(deviceId);
  if (existing) return existing;

  const run = withBackupLock(deviceId, () => runBackupInternal(deviceId, options)).finally(() => {
    if (inFlightBackups.get(deviceId) === run) inFlightBackups.delete(deviceId);
  });
  inFlightBackups.set(deviceId, run);
  return run;
}

async function runBackupInternal(deviceId: string, options: { notifyResult?: boolean }): Promise<Backup> {
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id: deviceId },
    include: { customer: true }
  });
  try {
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.start",
      "Backup gestart."
    );
    let backupSource: FortiGate = device;
    try {
      backupSource = await refreshFortiGateInventory(device.id);
    } catch (error) {
      await writeFortiGateLog(
        device.id,
        FortiGateLogLevel.WARN,
        "backup.inventory_unavailable",
        error instanceof Error ? error.message : "Inventory kon niet worden bijgewerkt; backup gaat door."
      );
    }

    const { attempt, config } = await fetchBackupConfig(backupSource);
    try {
      await updateFirmwareFromConfig(backupSource, config);
    } catch (error) {
      await writeFortiGateLog(
        device.id,
        FortiGateLogLevel.WARN,
        "backup.firmware_metadata_failed",
        error instanceof Error ? error.message : "Firmwaremetadata uit backup kon niet worden opgeslagen."
      );
    }
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
      const backup = await prisma.backup.create({
        data: {
          fortigateId: device.id,
          tenantId: device.customer.tenantId,
          configArtifactId: latest.configArtifactId,
          sha256: digest,
          filesize: config.byteLength,
          status: BackupStatus.UNCHANGED
        }
      });
      await auditSafely(device.id, {
        action: "backup.unchanged",
        tenantId: device.customer.tenantId,
        entity: "Backup",
        entityId: backup.id,
        metadata: { fortigateId: device.id, sha256: digest, bytes: config.byteLength }
      });
      if (options.notifyResult !== false) await notifyBackupResultSafely(device.id, backup.id);
      await applyBackupRetentionSafely(device.id, device.customer.tenantId);
      return backup;
    }

    const tenantId=device.customer.tenantId;
    const filename=artifactRelativePath(tenantId,device.id,digest);
    const fullPath=await writeImmutableArtifact(filename,config);
    let backup: Backup;
    try {
      backup = await tenantTransaction(tenantId,async(tx)=>{
        const artifact=await tx.configArtifact.upsert({where:{tenantId_fortigateId_sha256:{tenantId,fortigateId:device.id,sha256:digest}},create:{tenantId,fortigateId:device.id,sha256:digest,path:filename,filesize:config.byteLength},update:{}});
        const created=await tx.backup.create({data:{tenantId,fortigateId:device.id,configArtifactId:artifact.id,filename:path.relative(process.cwd(),fullPath),sha256:digest,filesize:config.byteLength,status:BackupStatus.CHANGED}});
        const existing=await tx.securityAnalysis.findUnique({where:{tenantId_fortigateId_configSha256:{tenantId,fortigateId:device.id,configSha256:digest}},select:{id:true}});
        const foundry=await tx.tenantFoundryConfig.findUnique({where:{tenantId},select:{enabled:true,endpoint:true,deployment:true,apiKeyEncrypted:true}});
        if(!existing&&foundry?.enabled&&foundry.endpoint&&foundry.deployment&&foundry.apiKeyEncrypted){const ruleset=await tx.securityRuleset.findFirst({where:{status:"ACTIVE"},select:{version:true}});if(!ruleset)throw new Error("ACTIVE_RULESET_MISSING");const analysis=await tx.securityAnalysis.create({data:{tenantId,fortigateId:device.id,configArtifactId:artifact.id,configSha256:digest,sourceBackupId:created.id,parserVersion:FORTIOS_PARSER_VERSION,rulesetVersion:ruleset.version,promptVersion:"1.0.0",foundryDeployment:foundry.deployment}});await tx.securityAnalysisJob.create({data:{tenantId,fortigateId:device.id,analysisId:analysis.id,targetRulesetVersion:ruleset.version}});}
        return created;
      });
    } catch (error) {
      throw error;
    }

    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.saved",
      "Backup opgeslagen.",
      { backupId: backup.id, sha256: digest, filename, bytes: config.byteLength }
    );

    await auditSafely(device.id, {
      action: "backup.changed",
      tenantId: device.customer.tenantId,
      entity: "Backup",
      entityId: backup.id,
      metadata: { fortigateId: device.id, sha256: digest, filename }
    });
    const completedBackup = await uploadToItGlueSafely(device.id, backup, config, filename);
    if (options.notifyResult !== false) await notifyBackupResultSafely(device.id, completedBackup.id);
    await applyBackupRetentionSafely(device.id, device.customer.tenantId);
    return completedBackup;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backup error.";
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.ERROR,
      "backup.failed",
      message
    );
    const backup = await prisma.backup.create({
      data: {
        fortigateId: device.id,
        tenantId: device.customer.tenantId,
        status: BackupStatus.FAILED,
        error: message
      }
    });
    await auditSafely(device.id, {
      action: "backup.failed",
      tenantId: device.customer.tenantId,
      outcome: "failure",
      entity: "Backup",
      entityId: backup.id,
      metadata: { fortigateId: device.id, error: message }
    });
    if (options.notifyResult !== false) await notifyBackupResultSafely(device.id, backup.id);
    await applyBackupRetentionSafely(device.id, device.customer.tenantId);
    return backup;
  }
}

async function uploadToItGlueSafely(deviceId: string, backup: Backup, config: Buffer, filename: string) {
  try {
    const uploadTarget = await prisma.fortiGate.findUniqueOrThrow({
      where: { id: deviceId },
      include: { customer: true }
    });
    const upload = await uploadBackupToItGlue({
      tenantId: uploadTarget.customer.tenantId,
      device: uploadTarget,
      backup,
      config,
      filename
    });
    if (upload.skipped) return backup;

    await writeFortiGateLog(
      deviceId,
      FortiGateLogLevel.INFO,
      "itglue.uploaded",
      "Backupconfiguratie als IT Glue bijlage verwerkt.",
      { attachmentId: upload.attachmentId, configurationId: uploadTarget.itGlueConfigurationId }
    );
    return await prisma.backup.update({
      where: { id: backup.id },
      data: {
        itGlueAttachmentId: upload.attachmentId,
        itGlueUploadedAt: new Date(),
        itGlueError: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende IT Glue upload fout.";
    await writeFortiGateLog(deviceId, FortiGateLogLevel.WARN, "itglue.upload_failed", message);
    try {
      return await prisma.backup.update({ where: { id: backup.id }, data: { itGlueError: message } });
    } catch (updateError) {
      await writeFortiGateLog(
        deviceId,
        FortiGateLogLevel.WARN,
        "itglue.error_state_failed",
        updateError instanceof Error ? updateError.message : "IT Glue foutstatus kon niet worden opgeslagen."
      );
      return backup;
    }
  }
}

async function auditSafely(deviceId: string, input: Parameters<typeof auditLog>[0]) {
  try {
    await auditLog(input);
  } catch (error) {
    await writeFortiGateLog(
      deviceId,
      FortiGateLogLevel.WARN,
      "audit.write_failed",
      error instanceof Error ? error.message : "Auditregel kon niet worden opgeslagen."
    );
  }
}

async function notifyBackupResultSafely(deviceId: string, backupId: string) {
  try {
    await notifyBackupResult(backupId);
  } catch (error) {
    await writeFortiGateLog(
      deviceId,
      FortiGateLogLevel.WARN,
      "backup.notification_pipeline_failed",
      error instanceof Error ? error.message : "Backupnotificaties konden niet volledig worden verwerkt.",
      { backupId }
    );
  }
}

async function applyBackupRetentionSafely(deviceId: string, tenantId: string) {
  try {
    await applyBackupRetention(deviceId, tenantId);
  } catch (error) {
    await writeFortiGateLog(
      deviceId,
      FortiGateLogLevel.WARN,
      "backup.retention_failed",
      error instanceof Error ? error.message : "Backupretentie kon niet worden toegepast."
    );
  }
}

async function withBackupLock<T>(deviceId: string, task: () => Promise<T>) {
  const lockDirectory = path.resolve(process.cwd(), "data", "temp", "backup-locks");
  await mkdir(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, `${safeFilenameSegment(deviceId, "fortigate")}.lock`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  for (let attempt = 0; attempt < 2 && !handle; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const details = await stat(lockPath).catch(() => null);
      if (attempt === 0 && !details) continue;
      if (attempt === 0 && details && Date.now() - details.mtimeMs > BACKUP_LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      throw new BackupAlreadyRunningError(deviceId);
    }
  }
  if (!handle) throw new BackupAlreadyRunningError(deviceId);

  let heartbeat: NodeJS.Timeout | null = null;
  try {
    await handle.writeFile(JSON.stringify({ deviceId, pid: process.pid, startedAt: new Date().toISOString() }));
    heartbeat = setInterval(() => {
      const now = new Date();
      void handle?.utimes(now, now).catch(() => undefined);
    }, 60_000);
    heartbeat.unref();
    return await task();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
