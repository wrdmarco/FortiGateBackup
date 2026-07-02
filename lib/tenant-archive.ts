import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupStatus, FortiGateLogLevel, ScheduleType } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { removeBackupFiles } from "@/lib/backup-cleanup";
import { backupFilePath } from "@/lib/backups";
import { prisma } from "@/lib/db";
import { createStoreZip, readStoreZip } from "@/lib/zip-store";

const ARCHIVE_VERSION = 1;

type ArchiveRecord = Record<string, unknown>;
type ArchiveDevice = ArchiveRecord & {
  backups?: ArchiveRecord[];
  logs?: ArchiveRecord[];
  versionHistory?: ArchiveRecord[];
};
type ArchiveCustomer = ArchiveRecord & {
  devices?: ArchiveDevice[];
};
type ArchiveManifest = {
  archiveVersion: number;
  tenant: ArchiveRecord & { id?: string; name?: string; active?: boolean };
  settings?: ArchiveRecord[];
  customers?: ArchiveCustomer[];
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" ? value : fallback;
}

function dateValue(value: unknown) {
  return typeof value === "string" || value instanceof Date ? new Date(value) : undefined;
}

function nullableDateValue(value: unknown) {
  const date = dateValue(value);
  return date ?? null;
}

function scheduleValue(value: unknown) {
  const raw = stringValue(value);
  return raw && raw in ScheduleType ? (raw as ScheduleType) : ScheduleType.DAILY;
}

function backupStatusValue(value: unknown) {
  const raw = stringValue(value);
  return raw && raw in BackupStatus ? (raw as BackupStatus) : BackupStatus.FAILED;
}

function logLevelValue(value: unknown) {
  const raw = stringValue(value);
  return raw && raw in FortiGateLogLevel ? (raw as FortiGateLogLevel) : FortiGateLogLevel.INFO;
}

function safeSegment(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "item"
  );
}

function backupArchiveName(backup: { id: string; createdAt: Date; filename: string | null }) {
  const stamp = backup.createdAt.toISOString().replace(/[:.]/g, "-");
  const extension = backup.filename ? path.extname(backup.filename) || ".conf" : ".conf";
  return `${stamp}-${backup.id}${extension}`;
}

function backupStoragePath(fortigateId: string, archiveName: string) {
  const backupRoot = path.resolve(process.cwd(), "data", "backups");
  const fullPath = path.resolve(backupRoot, fortigateId, path.basename(archiveName));
  if (!fullPath.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Ongeldig backup pad.");
  return fullPath;
}

function slugBase(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tenant"
  );
}

async function uniqueTenantSlug(preferred: string) {
  const base = slugBase(preferred);
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createTenantArchive(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: {
      settings: true,
      customers: {
        orderBy: { name: "asc" },
        include: {
          devices: {
            orderBy: [{ hostname: "asc" }, { managementUrl: "asc" }],
            include: {
              backups: { orderBy: { createdAt: "desc" } },
              logs: { orderBy: { createdAt: "desc" } },
              versionHistory: { orderBy: { detectedAt: "desc" } }
            }
          }
        }
      }
    }
  });

  const entries: Array<{ name: string; data: Buffer | string }> = [];
  const manifest = {
    archiveVersion: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      active: tenant.active,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt
    },
    settings: tenant.settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      encrypted: setting.encrypted,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt
    })),
    customers: tenant.customers.map((customer) => {
      const customerPath = `customers/${safeSegment(`${customer.name}-${customer.id}`)}`;
      entries.push({
        name: `${customerPath}/customer.json`,
        data: JSON.stringify(customer, null, 2)
      });
      return {
        ...customer,
        tenant: undefined,
        devices: customer.devices.map((device) => {
          const deviceLabel = device.hostname ?? device.serialNumber ?? device.managementUrl;
          const devicePath = `${customerPath}/fortigates/${safeSegment(`${deviceLabel}-${device.id}`)}`;
          entries.push({
            name: `${devicePath}/fortigate.json`,
            data: JSON.stringify(device, null, 2)
          });
          return {
            ...device,
            backups: device.backups.map((backup) => {
              const fileEntry = backup.filename ? `${devicePath}/backups/${backupArchiveName(backup)}` : null;
              return { ...backup, fileEntry };
            })
          };
        })
      };
    })
  };

  for (const customer of manifest.customers) {
    for (const device of customer.devices) {
      for (const backup of device.backups) {
        if (!backup.filename || !backup.fileEntry) continue;
        try {
          const file = await import("node:fs/promises").then((fs) => fs.readFile(backupFilePath(backup.filename!)));
          entries.push({ name: backup.fileEntry, data: file });
        } catch {
          // Missing config files are represented by metadata only.
        }
      }
    }
  }

  entries.unshift({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });
  return {
    filename: `${safeSegment(tenant.name)}-tenant-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    buffer: createStoreZip(entries)
  };
}

export function tenantIdFromArchive(archive: Buffer) {
  const entries = readStoreZip(archive);
  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new Error("Zip bevat geen manifest.json.");
  const manifest = JSON.parse(manifestEntry.toString("utf8")) as ArchiveManifest;
  const tenantId = stringValue(manifest.tenant?.id);
  if (!tenantId) throw new Error("Tenant backup bevat geen tenant-id.");
  return tenantId;
}

export async function restoreTenantArchive({
  tenantId,
  archive,
  userId,
  createTenantIfMissing = false
}: {
  tenantId: string;
  archive: Buffer;
  userId: string;
  createTenantIfMissing?: boolean;
}) {
  const entries = readStoreZip(archive);
  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new Error("Zip bevat geen manifest.json.");
  const manifest = JSON.parse(manifestEntry.toString("utf8")) as ArchiveManifest;
  if (manifest.archiveVersion !== ARCHIVE_VERSION) throw new Error("Deze tenant backup versie wordt niet ondersteund.");
  if (manifest.tenant?.id !== tenantId) throw new Error("Deze backup hoort niet bij de gekozen tenant.");

  const existing = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      customers: {
        include: {
          devices: {
            include: {
              backups: true
            }
          }
        }
      }
    }
  });
  if (!existing) {
    if (!createTenantIfMissing) throw new Error("Tenant bestaat niet.");
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: stringValue(manifest.tenant.name) ?? "Herstelde tenant",
        slug: await uniqueTenantSlug(stringValue(manifest.tenant.slug) ?? stringValue(manifest.tenant.name) ?? "tenant"),
        active: booleanValue(manifest.tenant.active, true),
        createdAt: dateValue(manifest.tenant.createdAt),
        updatedAt: dateValue(manifest.tenant.updatedAt)
      }
    });
  }
  const oldDevices = (existing?.customers ?? []).flatMap((customer) => customer.devices);
  await removeBackupFiles({
    deviceIds: oldDevices.map((device) => device.id),
    filenames: oldDevices.flatMap((device) => device.backups.map((backup) => backup.filename))
  });

  await prisma.$transaction(async (tx) => {
    await tx.customer.deleteMany({ where: { tenantId } });
    await tx.systemSetting.deleteMany({ where: { tenantId } });
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        name: stringValue(manifest.tenant.name) ?? "Herstelde tenant",
        active: booleanValue(manifest.tenant.active, true)
      }
    });

    for (const setting of manifest.settings ?? []) {
      await tx.systemSetting.create({
        data: {
          tenantId,
          key: stringValue(setting.key) ?? "",
          value: stringValue(setting.value) ?? "",
          encrypted: Boolean(setting.encrypted),
          createdAt: dateValue(setting.createdAt),
          updatedAt: dateValue(setting.updatedAt)
        }
      });
    }

    for (const customer of manifest.customers ?? []) {
      await tx.customer.create({
        data: {
          id: stringValue(customer.id) ?? undefined,
          tenantId,
          name: stringValue(customer.name) ?? "Herstelde klant",
          contact: stringValue(customer.contact),
          email: stringValue(customer.email),
          phone: stringValue(customer.phone),
          notes: stringValue(customer.notes),
          itGlueOrganizationId: stringValue(customer.itGlueOrganizationId),
          active: booleanValue(customer.active, true),
          createdAt: dateValue(customer.createdAt),
          updatedAt: dateValue(customer.updatedAt)
        }
      });
      for (const device of customer.devices ?? []) {
        await tx.fortiGate.create({
          data: {
            id: stringValue(device.id) ?? undefined,
            customerId: stringValue(customer.id) ?? "",
            hostname: stringValue(device.hostname),
            serialNumber: stringValue(device.serialNumber),
            model: stringValue(device.model),
            firmwareVersion: stringValue(device.firmwareVersion),
            firmwareBuild: stringValue(device.firmwareBuild),
            uptime: stringValue(device.uptime),
            externalIpAddresses: stringValue(device.externalIpAddresses),
            licenseInfo: stringValue(device.licenseInfo),
            itGlueConfigurationId: stringValue(device.itGlueConfigurationId),
            managementUrl: stringValue(device.managementUrl) ?? "",
            httpsPort: numberValue(device.httpsPort, 443),
            apiTokenEncrypted: stringValue(device.apiTokenEncrypted) ?? "",
            tlsVerify: booleanValue(device.tlsVerify),
            vdom: stringValue(device.vdom),
            scheduleType: scheduleValue(device.scheduleType),
            cronExpression: stringValue(device.cronExpression),
            nextRunAt: nullableDateValue(device.nextRunAt),
            lastCheckedAt: nullableDateValue(device.lastCheckedAt),
            active: booleanValue(device.active, true),
            createdAt: dateValue(device.createdAt),
            updatedAt: dateValue(device.updatedAt)
          }
        });
        for (const backup of device.backups ?? []) {
          const fileEntry = stringValue(backup.fileEntry);
          const restoredFilename = fileEntry ? path.relative(process.cwd(), backupStoragePath(stringValue(device.id) ?? "", fileEntry)) : null;
          await tx.backup.create({
            data: {
              id: stringValue(backup.id) ?? undefined,
              fortigateId: stringValue(device.id) ?? "",
              filename: restoredFilename,
              sha256: stringValue(backup.sha256),
              filesize: numberValue(backup.filesize),
              status: backupStatusValue(backup.status),
              error: stringValue(backup.error),
              itGlueAttachmentId: stringValue(backup.itGlueAttachmentId),
              itGlueUploadedAt: nullableDateValue(backup.itGlueUploadedAt),
              itGlueError: stringValue(backup.itGlueError),
              createdAt: dateValue(backup.createdAt)
            }
          });
        }
        for (const log of device.logs ?? []) {
          await tx.fortiGateLog.create({
            data: {
              id: stringValue(log.id) ?? undefined,
              fortigateId: stringValue(device.id) ?? "",
              level: logLevelValue(log.level),
              event: stringValue(log.event) ?? "restore.imported",
              message: stringValue(log.message) ?? "Geimporteerd vanuit tenant backup.",
              metadata: stringValue(log.metadata),
              createdAt: dateValue(log.createdAt)
            }
          });
        }
        for (const version of device.versionHistory ?? []) {
          await tx.versionHistory.create({
            data: {
              id: stringValue(version.id) ?? undefined,
              fortigateId: stringValue(device.id) ?? "",
              firmwareVersion: stringValue(version.firmwareVersion) ?? "unknown",
              firmwareBuild: stringValue(version.firmwareBuild),
              detectedAt: dateValue(version.detectedAt)
            }
          });
        }
      }
    }
  });

  for (const customer of manifest.customers ?? []) {
    for (const device of customer.devices ?? []) {
      for (const backup of device.backups ?? []) {
        const fileEntry = stringValue(backup.fileEntry);
        if (!fileEntry) continue;
        const content = entries.get(fileEntry);
        if (!content) continue;
        const target = backupStoragePath(stringValue(device.id) ?? "", fileEntry);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
  }

  await auditLog({
    action: "tenant.restored",
    tenantId,
    userId,
    entity: "Tenant",
    entityId: tenantId,
    metadata: {
      sourceTenant: manifest.tenant.name,
      customers: manifest.customers?.length ?? 0
    }
  });
}
