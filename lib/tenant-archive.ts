import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AuthProvider, BackupStatus, FortiGateLogLevel, ScheduleType, TenantKind, UserRole } from "@prisma/client";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { backupFilePath } from "@/lib/backups";
import { prisma } from "@/lib/db";
import { createStoreZip, DEFAULT_STORE_ZIP_LIMITS, readStoreZip } from "@/lib/zip-store";

const ARCHIVE_VERSION = 2;
const ARCHIVE_HMAC_ALGORITHM = "HMAC-SHA256";
const ARCHIVE_HMAC_CONTEXT = "fortigate-backup-portal:tenant-archive:v2";
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_CUSTOMERS = 5_000;
const MAX_DEVICES = 20_000;
const MAX_BACKUPS = 250_000;
const MAX_DEVICE_LOGS = 250_000;
const MAX_VERSION_RECORDS = 250_000;
const MAX_USERS = 50_000;
const MAX_ROLES = 5_000;
const MAX_ROLE_ASSIGNMENTS = 100_000;
const MAX_AUDIT_RECORDS = 500_000;

export const TENANT_ARCHIVE_MAX_UPLOAD_BYTES = DEFAULT_STORE_ZIP_LIMITS.maxArchiveBytes;
export const TENANT_ARCHIVE_SCOPE = Object.freeze({
  included: [
    "tenant-metadata",
    "tenant-settings",
    "customers",
    "fortigates",
    "backup-history",
    "backup-config-files",
    "fortigate-logs",
    "firmware-version-history",
    "users-without-auth-sessions",
    "roles-and-permissions",
    "user-role-assignments",
    "tenant-audit-log-with-snapshots"
  ],
  excluded: ["accounts", "sessions", "oauth-tokens", "verification-tokens", "setup-tokens"],
  portability: "installation-bound"
});

export class TenantArchiveError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = "TenantArchiveError";
  }
}

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,191}$/, "ongeldig id");
const dateSchema = z.string().datetime({ offset: true }).max(64);
const nullableDateSchema = dateSchema.nullable().optional();
const nullableText = (max: number) => z.string().max(max).nullable().optional();

const backupSchema = z
  .object({
    id: idSchema,
    fortigateId: idSchema.optional(),
    filename: nullableText(1_024),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
    filesize: z.number().int().min(0).max(0x7fffffff),
    status: z.nativeEnum(BackupStatus),
    error: nullableText(16_384),
    itGlueAttachmentId: nullableText(512),
    itGlueUploadedAt: nullableDateSchema,
    itGlueError: nullableText(16_384),
    autotaskTicketId: nullableText(512),
    autotaskTicketCreatedAt: nullableDateSchema,
    autotaskError: nullableText(16_384),
    createdAt: dateSchema.optional(),
    fileEntry: nullableText(DEFAULT_STORE_ZIP_LIMITS.maxEntryNameBytes),
    fileSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional()
  })
  .strict();

const fortigateLogSchema = z
  .object({
    id: idSchema,
    fortigateId: idSchema.optional(),
    level: z.nativeEnum(FortiGateLogLevel),
    event: z.string().min(1).max(255),
    message: z.string().max(65_536),
    metadata: nullableText(2 * 1024 * 1024),
    createdAt: dateSchema.optional()
  })
  .strict();

const versionHistorySchema = z
  .object({
    id: idSchema,
    fortigateId: idSchema.optional(),
    firmwareVersion: z.string().min(1).max(255),
    firmwareBuild: nullableText(255),
    detectedAt: dateSchema.optional()
  })
  .strict();

const deviceSchema = z
  .object({
    id: idSchema,
    customerId: idSchema.optional(),
    hostname: nullableText(255),
    serialNumber: nullableText(255),
    model: nullableText(255),
    firmwareVersion: nullableText(255),
    firmwareBuild: nullableText(255),
    uptime: nullableText(1_024),
    externalIpAddresses: nullableText(8_192),
    licenseInfo: nullableText(65_536),
    itGlueConfigurationId: nullableText(512),
    managementUrl: z.string().min(1).max(2_048),
    httpsPort: z.number().int().min(1).max(65_535),
    apiTokenEncrypted: z.string().min(1).max(65_536),
    tlsVerify: z.boolean(),
    tlsCertificateFingerprint: nullableText(128),
    tlsCertificateSubject: nullableText(2_048),
    tlsCertificateIssuer: nullableText(2_048),
    tlsCertificateValidFrom: nullableDateSchema,
    tlsCertificateValidTo: nullableDateSchema,
    tlsCertificateAcceptedAt: nullableDateSchema,
    vdom: nullableText(255),
    scheduleType: z.nativeEnum(ScheduleType),
    cronExpression: nullableText(255),
    nextRunAt: nullableDateSchema,
    lastCheckedAt: nullableDateSchema,
    active: z.boolean(),
    createdAt: dateSchema.optional(),
    updatedAt: dateSchema.optional(),
    backups: z.array(backupSchema).max(MAX_BACKUPS).default([]),
    logs: z.array(fortigateLogSchema).max(MAX_DEVICE_LOGS).default([]),
    versionHistory: z.array(versionHistorySchema).max(MAX_VERSION_RECORDS).default([])
  })
  .strict();

const customerSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema.optional(),
    name: z.string().min(1).max(255),
    contact: nullableText(255),
    email: nullableText(320),
    phone: nullableText(128),
    notes: nullableText(65_536),
    itGlueOrganizationId: nullableText(512),
    autotaskCompanyId: nullableText(512),
    active: z.boolean(),
    createdAt: dateSchema.optional(),
    updatedAt: dateSchema.optional(),
    devices: z.array(deviceSchema).max(MAX_DEVICES).default([])
  })
  .strict();

const settingSchema = z
  .object({
    key: z.string().min(1).max(255),
    value: z.string().max(8 * 1024 * 1024),
    encrypted: z.boolean(),
    createdAt: dateSchema.optional(),
    updatedAt: dateSchema.optional()
  })
  .strict();

const archiveUserSchema = z
  .object({
    id: idSchema,
    name: nullableText(255),
    email: z.string().email().max(320),
    emailVerified: nullableDateSchema,
    image: nullableText(2_048),
    passwordHash: nullableText(1_024),
    mustChangePassword: z.boolean(),
    role: z.nativeEnum(UserRole),
    provider: z.nativeEnum(AuthProvider),
    active: z.boolean(),
    createdAt: dateSchema.optional(),
    updatedAt: dateSchema.optional()
  })
  .strict();

const archiveRoleSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(255),
    description: nullableText(2_048),
    system: z.boolean(),
    permissionKeys: z.array(z.string().min(1).max(255)).max(5_000),
    createdAt: dateSchema.optional(),
    updatedAt: dateSchema.optional()
  })
  .strict();

const roleAssignmentSchema = z
  .object({
    userId: idSchema,
    roleId: idSchema,
    assignedAt: dateSchema.optional()
  })
  .strict();

const auditRecordSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    tenantName: nullableText(255),
    userId: idSchema.nullable().optional(),
    actorId: idSchema.nullable().optional(),
    actorName: nullableText(255),
    actorEmail: nullableText(320),
    action: z.string().min(1).max(255),
    outcome: z.string().min(1).max(64),
    entity: nullableText(255),
    entityId: nullableText(255),
    metadata: nullableText(8 * 1024 * 1024),
    ipAddress: nullableText(255),
    requestId: nullableText(255),
    previousHash: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
    integrityHash: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
    createdAt: dateSchema
  })
  .strict();

const archiveManifestSchema = z
  .object({
    archiveVersion: z.number().int(),
    exportedAt: dateSchema,
    contents: z
      .object({
        included: z.array(z.string().min(1).max(128)).max(32),
        excluded: z.array(z.string().min(1).max(128)).max(32),
        portability: z.literal("installation-bound")
      })
      .strict(),
    integrity: z
      .object({
        algorithm: z.literal(ARCHIVE_HMAC_ALGORITHM),
        keyId: z.string().regex(/^[a-fA-F0-9]{16}$/),
        manifestHmac: z.string().regex(/^[a-fA-F0-9]{64}$/),
        installationBound: z.literal(true)
      })
      .strict(),
    tenant: z
      .object({
        id: idSchema,
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        kind: z.nativeEnum(TenantKind),
        active: z.boolean(),
        createdAt: dateSchema.optional(),
        updatedAt: dateSchema.optional()
      })
      .strict(),
    settings: z.array(settingSchema).max(5_000).default([]),
    customers: z.array(customerSchema).max(MAX_CUSTOMERS).default([]),
    users: z.array(archiveUserSchema).max(MAX_USERS),
    roles: z.array(archiveRoleSchema).max(MAX_ROLES),
    roleAssignments: z.array(roleAssignmentSchema).max(MAX_ROLE_ASSIGNMENTS),
    auditLogs: z.array(auditRecordSchema).max(MAX_AUDIT_RECORDS)
  })
  .strict();

type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
type UnsignedArchiveManifest = Omit<ArchiveManifest, "integrity">;
type ArchiveBackup = z.infer<typeof backupSchema>;

type ParsedTenantArchive = {
  entries: Map<string, Buffer>;
  manifest: ArchiveManifest;
};

type StagedBackupFile = {
  backupId: string;
  deviceId: string;
  stagePath: string;
  targetPath: string;
  relativeFilename: string;
};

const parsedArchiveCache = new WeakMap<Buffer, { keyId: string; archiveSha256: string; parsed: ParsedTenantArchive }>();

function dateValue(value: string | null | undefined) {
  return value ? new Date(value) : undefined;
}

function nullableDateValue(value: string | null | undefined) {
  return value ? new Date(value) : null;
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

function backupRootPath() {
  return path.resolve(process.cwd(), "data", "backups");
}

function backupDeviceDirectory(deviceId: string) {
  const backupRoot = backupRootPath();
  const fullPath = path.resolve(backupRoot, deviceId);
  if (!fullPath.startsWith(`${backupRoot}${path.sep}`)) throw new TenantArchiveError("Ongeldig backup pad.");
  return fullPath;
}

function backupStoragePath(fortigateId: string, archiveName: string) {
  return path.join(backupDeviceDirectory(fortigateId), path.basename(archiveName));
}

function metadataPaths(customer: ArchiveManifest["customers"][number], device?: ArchiveManifest["customers"][number]["devices"][number]) {
  const customerPath = `customers/${safeSegment(`${customer.name}-${customer.id}`)}`;
  if (!device) return { customerPath, customerEntry: `${customerPath}/customer.json` };
  const deviceLabel = device.hostname ?? device.serialNumber ?? device.managementUrl;
  const devicePath = `${customerPath}/fortigates/${safeSegment(`${deviceLabel}-${device.id}`)}`;
  return {
    customerPath,
    customerEntry: `${customerPath}/customer.json`,
    devicePath,
    deviceEntry: `${devicePath}/fortigate.json`
  };
}

function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function archiveEncryptionKey() {
  const value = process.env.ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new TenantArchiveError("ENCRYPTION_KEY is niet geldig geconfigureerd.", 500);
  return value;
}

function archiveKeyId() {
  return createHash("sha256")
    .update(`${ARCHIVE_HMAC_CONTEXT}:key-id\0`, "utf8")
    .update(archiveEncryptionKey(), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TenantArchiveError("Manifest bevat een ongeldig getal.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${properties.join(",")}}`;
  }
  throw new TenantArchiveError("Manifest bevat een niet-ondersteunde waarde.");
}

function manifestHmac(manifest: UnsignedArchiveManifest) {
  return createHmac("sha256", archiveEncryptionKey())
    .update(`${ARCHIVE_HMAC_CONTEXT}\n`, "utf8")
    .update(canonicalJson(manifest), "utf8")
    .digest("hex");
}

function createManifestIntegrity(manifest: UnsignedArchiveManifest): ArchiveManifest["integrity"] {
  return {
    algorithm: ARCHIVE_HMAC_ALGORITHM,
    keyId: archiveKeyId(),
    manifestHmac: manifestHmac(manifest),
    installationBound: true
  };
}

function verifyManifestIntegrity(manifest: ArchiveManifest) {
  const currentKeyId = archiveKeyId();
  if (manifest.integrity.keyId.toLowerCase() !== currentKeyId) {
    throw new TenantArchiveError(
      "Deze tenant backup is installatiegebonden en is niet door deze installatie ondertekend.",
      400
    );
  }
  const { integrity, ...unsignedManifest } = manifest;
  const expected = Buffer.from(manifestHmac(unsignedManifest), "hex");
  const actual = Buffer.from(integrity.manifestHmac, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TenantArchiveError("Integriteitscontrole van het tenantmanifest is mislukt.");
  }
  return currentKeyId;
}

function assertUnique(values: Set<string>, value: string, label: string) {
  if (values.has(value)) throw new TenantArchiveError(`Tenant backup bevat een dubbel ${label}: ${value}.`);
  values.add(value);
}

function parseTenantArchive(archive: Buffer): ParsedTenantArchive {
  const currentKeyId = archiveKeyId();
  const archiveSha256 = sha256(archive);
  const cached = parsedArchiveCache.get(archive);
  if (cached?.keyId === currentKeyId && cached.archiveSha256 === archiveSha256) return cached.parsed;

  let entries: Map<string, Buffer>;
  try {
    entries = readStoreZip(archive);
  } catch (error) {
    throw new TenantArchiveError(error instanceof Error ? error.message : "Ongeldig zipbestand.", 400, { cause: error });
  }

  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new TenantArchiveError("Zip bevat geen manifest.json.");
  if (manifestEntry.byteLength > MAX_MANIFEST_BYTES) throw new TenantArchiveError("Manifest is te groot.");

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestEntry.toString("utf8"));
  } catch (error) {
    throw new TenantArchiveError("manifest.json bevat geen geldige JSON.", 400, { cause: error });
  }
  const result = archiveManifestSchema.safeParse(rawManifest);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.length ? ` bij ${issue.path.join(".")}` : "";
    throw new TenantArchiveError(`Tenant backup manifest is ongeldig${location}: ${issue.message}.`);
  }
  const manifest = result.data;
  if (manifest.archiveVersion !== ARCHIVE_VERSION) {
    throw new TenantArchiveError("Deze tenant backup versie wordt niet ondersteund.");
  }
  const verifiedKeyId = verifyManifestIntegrity(manifest);
  if (manifest.tenant.kind !== TenantKind.CUSTOMER) {
    throw new TenantArchiveError("Alleen CUSTOMER-tenants kunnen worden geimporteerd; Global wordt nooit hersteld.", 403);
  }

  const customerIds = new Set<string>();
  const deviceIds = new Set<string>();
  const backupIds = new Set<string>();
  const logIds = new Set<string>();
  const versionIds = new Set<string>();
  const settingKeys = new Set<string>();
  const userIds = new Set<string>();
  const userEmails = new Set<string>();
  const roleIds = new Set<string>();
  const roleNames = new Set<string>();
  const assignmentKeys = new Set<string>();
  const auditIds = new Set<string>();
  const fileReferences = new Set<string>();
  const allowedEntries = new Set<string>(["manifest.json"]);
  let deviceCount = 0;
  let backupCount = 0;
  let logCount = 0;
  let versionCount = 0;

  for (const setting of manifest.settings) assertUnique(settingKeys, setting.key, "instellingssleutel");
  for (const user of manifest.users) {
    assertUnique(userIds, user.id, "gebruiker-id");
    const normalizedEmail = user.email.trim().toLowerCase();
    if (user.email !== normalizedEmail) throw new TenantArchiveError(`Gebruiker ${user.id} heeft geen genormaliseerd e-mailadres.`);
    assertUnique(userEmails, normalizedEmail, "gebruiker-e-mailadres");
    if (user.provider === AuthProvider.LOCAL && !user.passwordHash) {
      throw new TenantArchiveError(`Lokale gebruiker ${user.email} bevat geen passwordHash.`);
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new TenantArchiveError("Een CUSTOMER-tenant mag geen SUPER_ADMIN bevatten.", 403);
    }
  }
  if (!manifest.users.some((user) => user.active && user.role === UserRole.ADMIN)) {
    throw new TenantArchiveError("Tenant backup bevat geen actieve ADMIN en kan daarom niet veilig worden hersteld.");
  }

  for (const role of manifest.roles) {
    assertUnique(roleIds, role.id, "rol-id");
    assertUnique(roleNames, role.name.toLowerCase(), "rolnaam");
    const permissionKeys = new Set<string>();
    for (const permissionKey of role.permissionKeys) {
      assertUnique(permissionKeys, permissionKey, `permission in rol ${role.name}`);
      if (permissionKey.startsWith("platform.")) {
        throw new TenantArchiveError(`CUSTOMER-rol ${role.name} bevat een platformpermission.`, 403);
      }
    }
  }
  for (const assignment of manifest.roleAssignments) {
    assertUnique(assignmentKeys, `${assignment.userId}:${assignment.roleId}`, "roltoewijzing");
    if (!userIds.has(assignment.userId) || !roleIds.has(assignment.roleId)) {
      throw new TenantArchiveError("Tenant backup bevat een roltoewijzing buiten de eigen gebruikers of rollen.");
    }
  }

  let previousAuditOrder = "";
  for (const audit of manifest.auditLogs) {
    assertUnique(auditIds, audit.id, "audit-id");
    if (audit.tenantId !== manifest.tenant.id) throw new TenantArchiveError("Auditregel hoort niet bij de gearchiveerde tenant.");
    const order = `${audit.createdAt}\0${audit.id}`;
    if (previousAuditOrder && order < previousAuditOrder) throw new TenantArchiveError("Auditregels staan niet in canonieke volgorde.");
    previousAuditOrder = order;
  }
  for (const customer of manifest.customers) {
    assertUnique(customerIds, customer.id, "klant-id");
    const customerPaths = metadataPaths(customer);
    allowedEntries.add(customerPaths.customerEntry);
    if (!entries.has(customerPaths.customerEntry)) throw new TenantArchiveError(`Klantmetadata ontbreekt voor ${customer.id}.`);

    deviceCount += customer.devices.length;
    if (deviceCount > MAX_DEVICES) throw new TenantArchiveError("Tenant backup bevat te veel FortiGates.");
    for (const device of customer.devices) {
      assertUnique(deviceIds, device.id, "FortiGate-id");
      const devicePaths = metadataPaths(customer, device);
      allowedEntries.add(devicePaths.deviceEntry!);
      if (!entries.has(devicePaths.deviceEntry!)) throw new TenantArchiveError(`FortiGate-metadata ontbreekt voor ${device.id}.`);

      backupCount += device.backups.length;
      logCount += device.logs.length;
      versionCount += device.versionHistory.length;
      if (backupCount > MAX_BACKUPS) throw new TenantArchiveError("Tenant backup bevat te veel backuprecords.");
      if (logCount > MAX_DEVICE_LOGS) throw new TenantArchiveError("Tenant backup bevat te veel FortiGate-logregels.");
      if (versionCount > MAX_VERSION_RECORDS) throw new TenantArchiveError("Tenant backup bevat te veel firmwareversies.");

      for (const backup of device.backups) {
        assertUnique(backupIds, backup.id, "backup-id");
        validateBackupFileReference({ backup, devicePath: devicePaths.devicePath!, entries, allowedEntries, fileReferences });
      }
      for (const log of device.logs) assertUnique(logIds, log.id, "FortiGate-log-id");
      for (const version of device.versionHistory) assertUnique(versionIds, version.id, "firmwareversie-id");
    }
  }

  for (const entryName of entries.keys()) {
    if (!allowedEntries.has(entryName)) throw new TenantArchiveError(`Zip bevat een onverwachte entry: ${entryName}.`);
  }
  const parsed = { entries, manifest };
  parsedArchiveCache.set(archive, { keyId: verifiedKeyId, archiveSha256, parsed });
  return parsed;
}

function validateBackupFileReference({
  backup,
  devicePath,
  entries,
  allowedEntries,
  fileReferences
}: {
  backup: ArchiveBackup;
  devicePath: string;
  entries: Map<string, Buffer>;
  allowedEntries: Set<string>;
  fileReferences: Set<string>;
}) {
  const fileEntry = backup.fileEntry ?? null;
  const hasFilename = Boolean(backup.filename);
  if (hasFilename !== Boolean(fileEntry)) {
    throw new TenantArchiveError(`Backup ${backup.id} heeft inconsistente bestandsmetadata.`);
  }
  if (backup.status === BackupStatus.CHANGED && !fileEntry) {
    throw new TenantArchiveError(`Gewijzigde backup ${backup.id} bevat geen configuratiebestand.`);
  }
  if (!fileEntry) return;
  if (!fileEntry.startsWith(`${devicePath}/backups/`) || path.posix.basename(fileEntry) !== fileEntry.slice(fileEntry.lastIndexOf("/") + 1)) {
    throw new TenantArchiveError(`Backup ${backup.id} verwijst naar een ongeldig archiefpad.`);
  }
  assertUnique(fileReferences, fileEntry.toLowerCase(), "bestandsreferentie");
  allowedEntries.add(fileEntry);
  const content = entries.get(fileEntry);
  if (!content) throw new TenantArchiveError(`Configuratiebestand ontbreekt voor backup ${backup.id}.`);
  if (content.byteLength !== backup.filesize) throw new TenantArchiveError(`Bestandsgrootte klopt niet voor backup ${backup.id}.`);
  const digest = sha256(content);
  if (backup.sha256 && digest !== backup.sha256.toLowerCase()) throw new TenantArchiveError(`SHA-256 klopt niet voor backup ${backup.id}.`);
  if (backup.fileSha256 && digest !== backup.fileSha256.toLowerCase()) throw new TenantArchiveError(`Archiefhash klopt niet voor backup ${backup.id}.`);
}

export async function createTenantArchive(tenantId: string) {
  const snapshot = await prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: {
          settings: { orderBy: [{ key: "asc" }, { id: "asc" }] },
          users: {
            orderBy: [{ email: "asc" }, { id: "asc" }],
            include: {
              accessRoles: { orderBy: [{ assignedAt: "asc" }, { roleId: "asc" }] }
            }
          },
          accessRoles: {
            orderBy: [{ name: "asc" }, { id: "asc" }],
            include: { permissions: { include: { permission: { select: { key: true } } } } }
          },
          customers: {
            orderBy: [{ name: "asc" }, { id: "asc" }],
            include: {
              devices: {
                orderBy: [{ hostname: "asc" }, { managementUrl: "asc" }, { id: "asc" }],
                include: {
                  backups: { orderBy: [{ createdAt: "desc" }, { id: "asc" }] },
                  logs: { orderBy: [{ createdAt: "desc" }, { id: "asc" }] },
                  versionHistory: { orderBy: [{ detectedAt: "desc" }, { id: "asc" }] }
                }
              }
            }
          }
        }
      });
      if (!tenant) return null;
      const auditLogs = await tx.auditLog.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_AUDIT_RECORDS + 1
      });
      return { tenant, auditLogs };
    },
    { maxWait: 30_000, timeout: 60_000 }
  );
  if (!snapshot) throw new TenantArchiveError("Tenant bestaat niet.", 404);
  const { tenant, auditLogs } = snapshot;
  if (tenant.kind !== TenantKind.CUSTOMER) {
    throw new TenantArchiveError("Global kan nooit als tenantarchief worden geexporteerd.", 403);
  }
  if (tenant.users.length > MAX_USERS || tenant.accessRoles.length > MAX_ROLES || auditLogs.length > MAX_AUDIT_RECORDS) {
    throw new TenantArchiveError("Tenant bevat meer identiteits- of auditrecords dan veilig kunnen worden gearchiveerd.", 413);
  }
  if (!tenant.users.some((user) => user.active && user.role === UserRole.ADMIN)) {
    throw new TenantArchiveError("Tenant heeft geen actieve ADMIN en kan niet veilig worden gearchiveerd.", 409);
  }
  const normalizedUserEmails = new Set<string>();
  for (const user of tenant.users) {
    if (user.role === UserRole.SUPER_ADMIN) throw new TenantArchiveError("CUSTOMER-tenant bevat ten onrechte een SUPER_ADMIN.", 409);
    const normalizedEmail = user.email.trim().toLowerCase();
    if (normalizedUserEmails.has(normalizedEmail)) {
      throw new TenantArchiveError(`Tenant bevat het e-mailadres ${normalizedEmail} meer dan eenmaal.`, 409);
    }
    normalizedUserEmails.add(normalizedEmail);
    if (user.provider === AuthProvider.LOCAL && !user.passwordHash) {
      throw new TenantArchiveError(`Lokale gebruiker ${user.email} heeft geen passwordHash.`, 409);
    }
  }
  for (const role of tenant.accessRoles) {
    if (role.permissions.some((assignment) => assignment.permission.key.startsWith("platform."))) {
      throw new TenantArchiveError(`CUSTOMER-rol ${role.name} bevat een platformpermission.`, 409);
    }
  }

  const entries: Array<{ name: string; data: Buffer | string }> = [];
  const archivedCustomers: Array<Record<string, unknown>> = [];
  let backupFileBytes = 0;

  for (const customer of tenant.customers) {
    const { devices, ...customerRecord } = customer;
    const customerPath = `customers/${safeSegment(`${customer.name}-${customer.id}`)}`;
    entries.push({ name: `${customerPath}/customer.json`, data: JSON.stringify(customerRecord, null, 2) });
    const archivedDevices: Array<Record<string, unknown>> = [];

    for (const device of devices) {
      const { backups, logs, versionHistory, ...deviceRecord } = device;
      const deviceLabel = device.hostname ?? device.serialNumber ?? device.managementUrl;
      const devicePath = `${customerPath}/fortigates/${safeSegment(`${deviceLabel}-${device.id}`)}`;
      entries.push({ name: `${devicePath}/fortigate.json`, data: JSON.stringify(deviceRecord, null, 2) });
      const archivedBackups: Array<Record<string, unknown>> = [];

      for (const backup of backups) {
        if (!backup.filename) {
          if (backup.status === BackupStatus.CHANGED) {
            throw new TenantArchiveError(`Gewijzigde backup ${backup.id} heeft geen configuratiebestand in de database.`, 409);
          }
          archivedBackups.push({ ...backup, fileEntry: null, fileSha256: null });
          continue;
        }

        const fileEntry = `${devicePath}/backups/${backupArchiveName(backup)}`;
        let fileStats;
        let file: Buffer;
        try {
          const sourcePath = backupFilePath(backup.filename);
          fileStats = await stat(sourcePath);
          if (!fileStats.isFile()) throw new Error("pad is geen bestand");
          if (fileStats.size > DEFAULT_STORE_ZIP_LIMITS.maxEntryBytes) throw new Error("bestand overschrijdt de archieflimiet");
          backupFileBytes += fileStats.size;
          if (backupFileBytes > DEFAULT_STORE_ZIP_LIMITS.maxTotalUncompressedBytes) throw new Error("tenantbestanden overschrijden de archieflimiet");
          file = await readFile(sourcePath);
        } catch (error) {
          throw new TenantArchiveError(`Configuratiebestand voor backup ${backup.id} kan niet volledig worden geexporteerd.`, 409, {
            cause: error
          });
        }
        if (file.byteLength !== fileStats.size || file.byteLength !== backup.filesize) {
          throw new TenantArchiveError(`Bestandsgrootte in de database klopt niet voor backup ${backup.id}.`, 409);
        }
        const digest = sha256(file);
        if (backup.sha256 && digest !== backup.sha256.toLowerCase()) {
          throw new TenantArchiveError(`SHA-256 in de database klopt niet voor backup ${backup.id}.`, 409);
        }
        entries.push({ name: fileEntry, data: file });
        archivedBackups.push({ ...backup, fileEntry, fileSha256: digest });
      }

      archivedDevices.push({ ...deviceRecord, backups: archivedBackups, logs, versionHistory });
    }
    archivedCustomers.push({ ...customerRecord, devices: archivedDevices });
  }

  const archivedUsers = tenant.users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email.trim().toLowerCase(),
    emailVerified: user.emailVerified,
    image: user.image,
    passwordHash: user.provider === AuthProvider.LOCAL ? user.passwordHash : null,
    mustChangePassword: user.mustChangePassword,
    role: user.role,
    provider: user.provider,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }));
  const archivedRoles = tenant.accessRoles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    system: role.system,
    permissionKeys: role.permissions.map((assignment) => assignment.permission.key).sort(),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
  }));
  const archivedRoleIds = new Set(archivedRoles.map((role) => role.id));
  const roleAssignments = tenant.users
    .flatMap((user) =>
      user.accessRoles.map((assignment) => ({
        userId: user.id,
        roleId: assignment.roleId,
        assignedAt: assignment.assignedAt
      }))
    )
    .sort((left, right) => `${left.userId}:${left.roleId}`.localeCompare(`${right.userId}:${right.roleId}`));
  if (roleAssignments.some((assignment) => !archivedRoleIds.has(assignment.roleId))) {
    throw new TenantArchiveError("Tenant bevat een roltoewijzing naar een rol van een andere tenant.", 409);
  }
  if (roleAssignments.length > MAX_ROLE_ASSIGNMENTS) throw new TenantArchiveError("Tenant bevat te veel roltoewijzingen.", 413);

  const rawUnsignedManifest = {
    archiveVersion: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    contents: TENANT_ARCHIVE_SCOPE,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      kind: tenant.kind,
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
    customers: archivedCustomers,
    users: archivedUsers,
    roles: archivedRoles,
    roleAssignments,
    auditLogs: auditLogs.map((audit) => ({ ...audit, tenantId }))
  };
  const unsignedManifest = JSON.parse(JSON.stringify(rawUnsignedManifest)) as UnsignedArchiveManifest;
  const manifest: ArchiveManifest = {
    ...unsignedManifest,
    integrity: createManifestIntegrity(unsignedManifest)
  };
  const manifestData = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(manifestData, "utf8") > MAX_MANIFEST_BYTES) throw new TenantArchiveError("Tenantmanifest is te groot.", 413);
  entries.unshift({ name: "manifest.json", data: manifestData });

  return {
    filename: `${safeSegment(tenant.name)}-tenant-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    buffer: createStoreZip(entries)
  };
}

export function tenantIdFromArchive(archive: Buffer) {
  return parseTenantArchive(archive).manifest.tenant.id;
}

async function stageBackupFiles(parsed: ParsedTenantArchive, operationId: string) {
  const stageRoot = path.join(backupRootPath(), ".restore-staging", operationId);
  const stagedFiles: StagedBackupFile[] = [];
  await mkdir(stageRoot, { recursive: true, mode: 0o700 });

  try {
    for (const customer of parsed.manifest.customers) {
      for (const device of customer.devices) {
        for (const backup of device.backups) {
          if (!backup.fileEntry) continue;
          const content = parsed.entries.get(backup.fileEntry);
          if (!content) throw new TenantArchiveError(`Configuratiebestand ontbreekt voor backup ${backup.id}.`);
          const rawExtension = path.posix.extname(backup.fileEntry);
          const extension = /^\.[A-Za-z0-9]{1,10}$/.test(rawExtension) ? rawExtension.toLowerCase() : ".conf";
          const finalName = `restore-${operationId}-${safeSegment(backup.id)}${extension}`;
          const stagePath = path.join(stageRoot, `${stagedFiles.length.toString().padStart(8, "0")}${extension}`);
          const targetPath = backupStoragePath(device.id, finalName);
          await writeFile(stagePath, content, { flag: "wx", mode: 0o600 });
          stagedFiles.push({
            backupId: backup.id,
            deviceId: device.id,
            stagePath,
            targetPath,
            relativeFilename: path.relative(process.cwd(), targetPath)
          });
        }
      }
    }
    return { stageRoot, stagedFiles };
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function publishStagedFiles(stagedFiles: StagedBackupFile[], publishedPaths: string[]) {
  const preparedDirectories = new Set<string>();
  for (const staged of stagedFiles) {
    const directory = path.dirname(staged.targetPath);
    if (!preparedDirectories.has(directory)) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      preparedDirectories.add(directory);
    }
    await link(staged.stagePath, staged.targetPath);
    publishedPaths.push(staged.targetPath);
  }
}

async function removePaths(paths: Iterable<string>) {
  let failures = 0;
  for (const target of paths) {
    try {
      await rm(target, { force: true });
    } catch {
      failures += 1;
    }
  }
  return failures;
}

async function cleanupReplacedBackupFiles({
  oldDevices,
  restoredDeviceIds,
  publishedPaths
}: {
  oldDevices: Array<{ id: string; backups: Array<{ filename: string | null }> }>;
  restoredDeviceIds: Set<string>;
  publishedPaths: Set<string>;
}) {
  let failures = 0;
  for (const device of oldDevices) {
    const deviceDirectory = backupDeviceDirectory(device.id);
    for (const backup of device.backups) {
      if (!backup.filename) continue;
      try {
        const oldPath = backupFilePath(backup.filename);
        if (!oldPath.startsWith(`${deviceDirectory}${path.sep}`) || publishedPaths.has(oldPath)) {
          failures += 1;
          continue;
        }
        await rm(oldPath, { force: true });
      } catch {
        failures += 1;
      }
    }
    if (!restoredDeviceIds.has(device.id)) {
      try {
        await rm(deviceDirectory, { recursive: true, force: true });
      } catch {
        failures += 1;
      }
    }
  }
  return failures;
}

function chunks<T>(values: T[], size = 400) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function validateRestorePreflight(manifest: ArchiveManifest, tenantId: string, createTenantIfMissing: boolean) {
  const [existingTenant, globalTenant, slugOwner, databaseUsers, databaseRoles, permissionRecords] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, kind: true } }),
    prisma.tenant.findFirst({ where: { kind: TenantKind.GLOBAL }, select: { id: true } }),
    prisma.tenant.findUnique({ where: { slug: manifest.tenant.slug }, select: { id: true } }),
    prisma.user.findMany({ select: { id: true, email: true, tenantId: true } }),
    prisma.accessRole.findMany({ select: { id: true, tenantId: true } }),
    prisma.accessPermission.findMany({ select: { id: true, key: true } })
  ]);

  if (manifest.tenant.kind !== TenantKind.CUSTOMER || tenantId === globalTenant?.id || existingTenant?.kind === TenantKind.GLOBAL) {
    throw new TenantArchiveError("Global kan nooit via tenant restore worden aangemaakt of overschreven.", 403);
  }
  if (!existingTenant && !createTenantIfMissing) throw new TenantArchiveError("Tenant bestaat niet.", 404);
  if (slugOwner && slugOwner.id !== tenantId) {
    throw new TenantArchiveError(`Tenant-slug ${manifest.tenant.slug} is al in gebruik.`, 409);
  }

  const archivedUsersById = new Map(manifest.users.map((user) => [user.id, user]));
  const archivedUsersByEmail = new Map(manifest.users.map((user) => [user.email, user]));
  const databaseUsersById = new Map(databaseUsers.map((user) => [user.id, user]));
  const existingArchiveUserIds = new Set<string>();

  for (const databaseUser of databaseUsers) {
    const normalizedEmail = databaseUser.email.trim().toLowerCase();
    const archivedById = archivedUsersById.get(databaseUser.id);
    const archivedByEmail = archivedUsersByEmail.get(normalizedEmail);
    if (existingTenant && databaseUser.tenantId === tenantId) {
      if (archivedById) existingArchiveUserIds.add(databaseUser.id);
      continue;
    }
    if (archivedById) {
      if (databaseUser.tenantId === null && normalizedEmail === archivedById.email) {
        existingArchiveUserIds.add(databaseUser.id);
      } else {
        throw new TenantArchiveError(`Gebruiker-id ${databaseUser.id} is al aan een andere identiteit gekoppeld.`, 409);
      }
    }
    if (archivedByEmail && archivedByEmail.id !== databaseUser.id) {
      throw new TenantArchiveError(`E-mailadres ${archivedByEmail.email} is al door een andere gebruiker in gebruik.`, 409);
    }
  }

  const archivedRoleIds = new Set(manifest.roles.map((role) => role.id));
  for (const role of databaseRoles) {
    if (archivedRoleIds.has(role.id) && role.tenantId !== tenantId) {
      throw new TenantArchiveError(`Rol-id ${role.id} is al in een andere tenant in gebruik.`, 409);
    }
  }

  const permissionIds = new Map(permissionRecords.map((permission) => [permission.key, permission.id]));
  for (const role of manifest.roles) {
    for (const permissionKey of role.permissionKeys) {
      if (!permissionIds.has(permissionKey)) {
        throw new TenantArchiveError(`Permission ${permissionKey} bestaat niet in deze applicatieversie.`, 409);
      }
    }
  }

  const archivedUserIds = new Set(manifest.users.map((user) => user.id));
  for (const audit of manifest.auditLogs) {
    if (!audit.userId || archivedUserIds.has(audit.userId)) continue;
    const actor = databaseUsersById.get(audit.userId);
    if (!actor || (existingTenant && actor.tenantId === tenantId)) {
      throw new TenantArchiveError(`Auditregel ${audit.id} verwijst naar een niet-herstelbare actor.`, 409);
    }
  }

  return { existingTenant, existingArchiveUserIds, permissionIds };
}

function archivedUserData(user: ArchiveManifest["users"][number], tenantId: string) {
  return {
    id: user.id,
    tenantId,
    name: user.name,
    email: user.email,
    emailVerified: nullableDateValue(user.emailVerified),
    image: user.image,
    passwordHash: user.provider === AuthProvider.LOCAL ? user.passwordHash : null,
    mustChangePassword: user.mustChangePassword,
    role: user.role,
    provider: user.provider,
    active: user.active,
    createdAt: dateValue(user.createdAt),
    updatedAt: dateValue(user.updatedAt)
  };
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
  const parsed = parseTenantArchive(archive);
  const { manifest } = parsed;
  if (manifest.tenant.id !== tenantId) throw new TenantArchiveError("Deze backup hoort niet bij de gekozen tenant.");
  const preflight = await validateRestorePreflight(manifest, tenantId, createTenantIfMissing);

  const operationId = randomUUID().replace(/-/g, "");
  const { stageRoot, stagedFiles } = await stageBackupFiles(parsed, operationId);
  const stagedByBackupId = new Map(stagedFiles.map((staged) => [staged.backupId, staged]));
  const publishedPaths: string[] = [];
  let oldDevices: Array<{ id: string; backups: Array<{ filename: string | null }> }> = [];
  const restoredDeviceIds = new Set(manifest.customers.flatMap((customer) => customer.devices.map((device) => device.id)));

  try {
    await prisma.$transaction(
      async (tx) => {
        const currentTarget = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, kind: true } });
        if (preflight.existingTenant) {
          if (!currentTarget) throw new TenantArchiveError("Tenant is tijdens restore verwijderd; probeer opnieuw.", 409);
          if (currentTarget.kind === TenantKind.GLOBAL) throw new TenantArchiveError("Global kan nooit worden overschreven.", 403);
        } else if (currentTarget) {
          throw new TenantArchiveError("Tenant is tijdens restore al aangemaakt; probeer opnieuw.", 409);
        }

        const replacedCustomers = await tx.customer.findMany({
          where: { tenantId },
          select: {
            devices: {
              select: {
                id: true,
                backups: { select: { filename: true } }
              }
            }
          }
        });
        oldDevices = replacedCustomers.flatMap((customer) => customer.devices);
        const currentTenantUsers = await tx.user.findMany({ where: { tenantId }, select: { id: true } });
        const archivedUserIds = manifest.users.map((user) => user.id);
        const archivedUserIdSet = new Set(archivedUserIds);

        await tx.auditLog.deleteMany({ where: { tenantId } });
        for (const userIds of chunks(archivedUserIds)) {
          await tx.userAccessRole.deleteMany({ where: { userId: { in: userIds } } });
          await tx.session.deleteMany({ where: { userId: { in: userIds } } });
          await tx.account.deleteMany({ where: { userId: { in: userIds } } });
        }
        await tx.accessRole.deleteMany({ where: { tenantId } });
        const removedUserIds = currentTenantUsers.map((user) => user.id).filter((id) => !archivedUserIdSet.has(id));
        for (const userIds of chunks(removedUserIds)) await tx.user.deleteMany({ where: { id: { in: userIds }, tenantId } });
        await tx.customer.deleteMany({ where: { tenantId } });
        await tx.systemSetting.deleteMany({ where: { tenantId } });
        const tenantData = {
          name: manifest.tenant.name,
          slug: manifest.tenant.slug,
          kind: TenantKind.CUSTOMER,
          active: manifest.tenant.active,
          createdAt: dateValue(manifest.tenant.createdAt),
          updatedAt: dateValue(manifest.tenant.updatedAt)
        };
        if (preflight.existingTenant) {
          await tx.tenant.update({ where: { id: tenantId }, data: tenantData });
        } else {
          await tx.tenant.create({ data: { id: tenantId, ...tenantData } });
        }

        const existingArchivedUsers = manifest.users.filter((user) => preflight.existingArchiveUserIds.has(user.id));
        for (const [index, user] of existingArchivedUsers.entries()) {
          const claimed = await tx.user.updateMany({
            where: { id: user.id, OR: [{ tenantId }, { tenantId: null }] },
            data: { email: `restore-${operationId}-${index}@invalid.local` }
          });
          if (claimed.count !== 1) throw new TenantArchiveError(`Gebruiker ${user.id} kon niet veilig worden gereserveerd.`, 409);
        }

        if (manifest.roles.length) {
          await tx.accessRole.createMany({
            data: manifest.roles.map((role) => ({
              id: role.id,
              tenantId,
              name: role.name,
              description: role.description,
              system: role.system,
              createdAt: dateValue(role.createdAt),
              updatedAt: dateValue(role.updatedAt)
            }))
          });
          const rolePermissions = manifest.roles.flatMap((role) =>
            role.permissionKeys.map((permissionKey) => ({
              roleId: role.id,
              permissionId: preflight.permissionIds.get(permissionKey)!
            }))
          );
          if (rolePermissions.length) await tx.accessRolePermission.createMany({ data: rolePermissions });
        }

        for (const user of existingArchivedUsers) {
          await tx.user.update({ where: { id: user.id }, data: archivedUserData(user, tenantId) });
        }
        const newUsers = manifest.users.filter((user) => !preflight.existingArchiveUserIds.has(user.id));
        if (newUsers.length) await tx.user.createMany({ data: newUsers.map((user) => archivedUserData(user, tenantId)) });
        if (manifest.roleAssignments.length) {
          await tx.userAccessRole.createMany({
            data: manifest.roleAssignments.map((assignment) => ({
              userId: assignment.userId,
              roleId: assignment.roleId,
              assignedAt: dateValue(assignment.assignedAt)
            }))
          });
        }

        if (manifest.settings.length) {
          await tx.systemSetting.createMany({
            data: manifest.settings.map((setting) => ({
              tenantId,
              key: setting.key,
              value: setting.value,
              encrypted: setting.encrypted,
              createdAt: dateValue(setting.createdAt),
              updatedAt: dateValue(setting.updatedAt)
            }))
          });
        }

        if (manifest.customers.length) {
          await tx.customer.createMany({
            data: manifest.customers.map((customer) => ({
              id: customer.id,
              tenantId,
              name: customer.name,
              contact: customer.contact,
              email: customer.email,
              phone: customer.phone,
              notes: customer.notes,
              itGlueOrganizationId: customer.itGlueOrganizationId,
              autotaskCompanyId: customer.autotaskCompanyId,
              active: customer.active,
              createdAt: dateValue(customer.createdAt),
              updatedAt: dateValue(customer.updatedAt)
            }))
          });
        }

        const devices = manifest.customers.flatMap((customer) =>
          customer.devices.map((device) => ({ customerId: customer.id, device }))
        );
        if (devices.length) {
          await tx.fortiGate.createMany({
            data: devices.map(({ customerId, device }) => ({
              id: device.id,
              customerId,
              hostname: device.hostname,
              serialNumber: device.serialNumber,
              model: device.model,
              firmwareVersion: device.firmwareVersion,
              firmwareBuild: device.firmwareBuild,
              uptime: device.uptime,
              externalIpAddresses: device.externalIpAddresses,
              licenseInfo: device.licenseInfo,
              itGlueConfigurationId: device.itGlueConfigurationId,
              managementUrl: device.managementUrl,
              httpsPort: device.httpsPort,
              apiTokenEncrypted: device.apiTokenEncrypted,
              tlsVerify: device.tlsVerify,
              tlsCertificateFingerprint: device.tlsCertificateFingerprint,
              tlsCertificateSubject: device.tlsCertificateSubject,
              tlsCertificateIssuer: device.tlsCertificateIssuer,
              tlsCertificateValidFrom: nullableDateValue(device.tlsCertificateValidFrom),
              tlsCertificateValidTo: nullableDateValue(device.tlsCertificateValidTo),
              tlsCertificateAcceptedAt: nullableDateValue(device.tlsCertificateAcceptedAt),
              vdom: device.vdom,
              scheduleType: device.scheduleType,
              cronExpression: device.cronExpression,
              nextRunAt: nullableDateValue(device.nextRunAt),
              lastCheckedAt: nullableDateValue(device.lastCheckedAt),
              active: device.active,
              createdAt: dateValue(device.createdAt),
              updatedAt: dateValue(device.updatedAt)
            }))
          });
        }

        const backups = devices.flatMap(({ device }) =>
          device.backups.map((backup) => ({ deviceId: device.id, backup }))
        );
        if (backups.length) {
          await tx.backup.createMany({
            data: backups.map(({ deviceId, backup }) => ({
              id: backup.id,
              fortigateId: deviceId,
              filename: stagedByBackupId.get(backup.id)?.relativeFilename ?? null,
              sha256: backup.sha256,
              filesize: backup.filesize,
              status: backup.status,
              error: backup.error,
              itGlueAttachmentId: backup.itGlueAttachmentId,
              itGlueUploadedAt: nullableDateValue(backup.itGlueUploadedAt),
              itGlueError: backup.itGlueError,
              autotaskTicketId: backup.autotaskTicketId,
              autotaskTicketCreatedAt: nullableDateValue(backup.autotaskTicketCreatedAt),
              autotaskError: backup.autotaskError,
              createdAt: dateValue(backup.createdAt)
            }))
          });
        }

        const logs = devices.flatMap(({ device }) => device.logs.map((log) => ({ deviceId: device.id, log })));
        if (logs.length) {
          await tx.fortiGateLog.createMany({
            data: logs.map(({ deviceId, log }) => ({
              id: log.id,
              fortigateId: deviceId,
              level: log.level,
              event: log.event,
              message: log.message,
              metadata: log.metadata,
              createdAt: dateValue(log.createdAt)
            }))
          });
        }

        const versions = devices.flatMap(({ device }) =>
          device.versionHistory.map((version) => ({ deviceId: device.id, version }))
        );
        if (versions.length) {
          await tx.versionHistory.createMany({
            data: versions.map(({ deviceId, version }) => ({
              id: version.id,
              fortigateId: deviceId,
              firmwareVersion: version.firmwareVersion,
              firmwareBuild: version.firmwareBuild,
              detectedAt: dateValue(version.detectedAt)
            }))
          });
        }

        if (manifest.auditLogs.length) {
          await tx.auditLog.createMany({
            data: manifest.auditLogs.map((audit) => ({
              id: audit.id,
              tenantId,
              tenantName: audit.tenantName,
              userId: audit.userId,
              actorId: audit.actorId ?? audit.userId,
              actorName: audit.actorName,
              actorEmail: audit.actorEmail,
              action: audit.action,
              outcome: audit.outcome,
              entity: audit.entity,
              entityId: audit.entityId,
              metadata: audit.metadata,
              ipAddress: audit.ipAddress,
              requestId: audit.requestId,
              previousHash: audit.previousHash,
              integrityHash: audit.integrityHash,
              createdAt: new Date(audit.createdAt)
            }))
          });
        }

        await publishStagedFiles(stagedFiles, publishedPaths);
      },
      { maxWait: 30_000, timeout: 10 * 60_000 }
    );
  } catch (error) {
    const cleanupFailures = await removePaths(publishedPaths);
    await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    if (cleanupFailures) {
      throw new TenantArchiveError(
        "Tenant restore is teruggedraaid, maar een of meer nieuwe, niet-gerefereerde bestanden konden niet worden opgeruimd.",
        500,
        { cause: error }
      );
    }
    throw error;
  }

  await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
  const cleanupFailures = await cleanupReplacedBackupFiles({
    oldDevices,
    restoredDeviceIds,
    publishedPaths: new Set(publishedPaths)
  });

  try {
    await auditLog({
      action: "tenant.restored",
      tenantId,
      userId,
      entity: "Tenant",
      entityId: tenantId,
      metadata: {
        sourceTenant: manifest.tenant.name,
        customers: manifest.customers.length,
        fortigates: restoredDeviceIds.size,
        backupFiles: stagedFiles.length,
        archiveContents: TENANT_ARCHIVE_SCOPE.included,
        archiveExcludes: TENANT_ARCHIVE_SCOPE.excluded,
        tenantCreated: !preflight.existingTenant,
        users: manifest.users.length,
        roles: manifest.roles.length,
        auditLogs: manifest.auditLogs.length,
        orphanCleanupFailures: cleanupFailures
      }
    });
  } catch (error) {
    throw new TenantArchiveError("Tenant restore is voltooid, maar de verplichte auditregistratie is mislukt.", 500, { cause: error });
  }
}
