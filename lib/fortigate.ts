import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupStatus, FortiGate } from "@prisma/client";
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

function baseUrl(device: FortiGate) {
  const url = new URL(device.managementUrl);
  url.port = String(device.httpsPort);
  return url.toString().replace(/\/$/, "");
}

async function fortigateFetch(device: FortiGate, endpoint: string) {
  const token = decryptSecret(device.apiTokenEncrypted);
  const response = await fetch(`${baseUrl(device)}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`FortiGate API returned ${response.status} for ${endpoint}.`);
  }
  return response;
}

export async function refreshFortiGateInventory(deviceId: string) {
  const device = await prisma.fortiGate.findUniqueOrThrow({ where: { id: deviceId } });
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
  }

  return updated;
}

export async function runBackup(deviceId: string) {
  const device = await prisma.fortiGate.findUniqueOrThrow({ where: { id: deviceId } });
  try {
    await refreshFortiGateInventory(device.id);
    const scope = device.vdom ? `vdom&vdom=${encodeURIComponent(device.vdom)}` : "global";
    const response = await fortigateFetch(
      device,
      `/api/v2/monitor/system/config/backup?scope=${scope}`
    );
    const config = Buffer.from(await response.arrayBuffer());
    const digest = sha256(config);
    const latest = await prisma.backup.findFirst({
      where: { fortigateId: device.id, status: BackupStatus.CHANGED },
      orderBy: { createdAt: "desc" }
    });

    if (latest?.sha256 === digest) {
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
    return prisma.backup.create({
      data: {
        fortigateId: device.id,
        status: BackupStatus.FAILED,
        error: message
      }
    });
  }
}
