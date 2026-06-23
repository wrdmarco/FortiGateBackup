import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupStatus, FortiGate, FortiGateLogLevel } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";

type FortiGateSystemStatus = {
  hostname?: string;
  serial?: string;
  model?: string;
  version?: string;
  build?: string | number;
  uptime?: string;
};

type RequestOptions = {
  headers: Record<string, string>;
  rejectUnauthorized?: boolean;
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
        method: "GET",
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

async function fortigateFetch(device: FortiGate, endpoint: string) {
  const token = decryptSecret(device.apiTokenEncrypted);
  const url = new URL(`${baseUrl(device)}${endpoint}`);
  let response: Response;
  try {
    response = await requestBuffer(url, {
      headers: { Authorization: `Bearer ${token}` },
      rejectUnauthorized: device.tlsVerify
    });
  } catch (error) {
    throw new Error(networkErrorMessage(error, endpoint));
  }
  if (!response.ok) {
    throw new Error(`FortiGate API returned ${response.status} for ${endpoint}.`);
  }
  return response;
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
    const payload = (await response.json()) as { results?: FortiGateSystemStatus };
    const status = payload.results ?? {};
    const updated = await prisma.fortiGate.update({
      where: { id: device.id },
      data: {
        hostname: status.hostname ?? device.hostname,
        serialNumber: status.serial ?? device.serialNumber,
        model: status.model ?? device.model,
        firmwareVersion: status.version ?? device.firmwareVersion,
        firmwareBuild: status.build ? String(status.build) : device.firmwareBuild,
        uptime: status.uptime ?? device.uptime,
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
        firmwareBuild: updated.firmwareBuild
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
    await refreshFortiGateInventory(device.id);
    const scope = device.vdom ? `vdom&vdom=${encodeURIComponent(device.vdom)}` : "global";
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.fetch_config",
      "Configuratie ophalen bij FortiGate.",
      { scope: device.vdom ? "vdom" : "global", vdom: device.vdom }
    );
    const response = await fortigateFetch(
      device,
      `/api/v2/monitor/system/config/backup?scope=${scope}`
    );
    const config = Buffer.from(await response.arrayBuffer());
    await writeFortiGateLog(
      device.id,
      FortiGateLogLevel.INFO,
      "backup.config_received",
      "Configuratie ontvangen.",
      { bytes: config.byteLength }
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
