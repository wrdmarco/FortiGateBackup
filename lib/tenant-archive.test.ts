import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { TENANT_ARCHIVE_SCOPE, TenantArchiveError, tenantIdFromArchive } from "./tenant-archive";
import { createStoreZip } from "./zip-store";

const TEST_KEY = "tenant-archive-test-encryption-key-000000000000000000";
const OTHER_KEY = "tenant-archive-other-encryption-key-00000000000000000";
const HMAC_CONTEXT = "fortigate-backup-portal:tenant-archive:v2";
process.env.ENCRYPTION_KEY = TEST_KEY;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function signManifest(unsignedManifest: Record<string, unknown>, key = TEST_KEY): Record<string, unknown> {
  const keyId = createHash("sha256").update(`${HMAC_CONTEXT}:key-id\0`, "utf8").update(key, "utf8").digest("hex").slice(0, 16);
  const manifestHmac = createHmac("sha256", key)
    .update(`${HMAC_CONTEXT}\n`, "utf8")
    .update(canonicalJson(unsignedManifest), "utf8")
    .digest("hex");
  return {
    ...unsignedManifest,
    integrity: { algorithm: "HMAC-SHA256", keyId, manifestHmac, installationBound: true }
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    archiveVersion: 2,
    exportedAt: "2026-07-14T10:00:00.000Z",
    contents: TENANT_ARCHIVE_SCOPE,
    tenant: {
      id: "tenant_1",
      name: "Klanttenant",
      slug: "klanttenant",
      kind: "CUSTOMER",
      active: true
    },
    settings: [],
    customers: [],
    users: [
      {
        id: "user_admin",
        name: "Tenant Admin",
        email: "admin@example.test",
        passwordHash: "$2b$12$archived-password-hash",
        mustChangePassword: false,
        role: "ADMIN",
        provider: "LOCAL",
        active: true
      }
    ],
    roles: [
      {
        id: "role_admin",
        name: "Tenant Admin",
        description: "Tenantbeheer",
        system: true,
        permissionKeys: ["tenant.users.update", "tenant.roles.update"]
      }
    ],
    roleAssignments: [{ userId: "user_admin", roleId: "role_admin" }],
    auditLogs: [],
    ...overrides
  };
}

function archiveFor(unsignedManifest: Record<string, unknown>, extraEntries: Array<{ name: string; data: string }> = [], key = TEST_KEY) {
  const signed = signManifest(unsignedManifest, key);
  return createStoreZip([{ name: "manifest.json", data: JSON.stringify(signed) }, ...extraEntries]);
}

test("tenant-id wordt alleen uit een volledig gevalideerd en ondertekend archief gelezen", () => {
  assert.equal(tenantIdFromArchive(archiveFor(manifest())), "tenant_1");
});

test("manifestmanipulatie wordt door de HMAC geweigerd", () => {
  const signed = signManifest(manifest());
  (signed.tenant as Record<string, unknown>).name = "Gemanipuleerd";
  const archive = createStoreZip([{ name: "manifest.json", data: JSON.stringify(signed) }]);
  assert.throws(() => tenantIdFromArchive(archive), /Integriteitscontrole/);
});

test("archieven zijn aan ENCRYPTION_KEY van de installatie gebonden", () => {
  const archive = archiveFor(manifest(), [], TEST_KEY);
  process.env.ENCRYPTION_KEY = OTHER_KEY;
  try {
    assert.throws(() => tenantIdFromArchive(archive), /installatiegebonden/);
  } finally {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  }
});

test("onbekende archiefversies en onverwachte entries worden geweigerd", () => {
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ archiveVersion: 99 }))), TenantArchiveError);
  assert.throws(
    () => tenantIdFromArchive(archiveFor(manifest(), [{ name: "unexpected.bin", data: "hidden" }])),
    /onverwachte entry/
  );
});

test("Global en een CUSTOMER zonder actieve ADMIN worden geweigerd", () => {
  const globalTenant = { id: "tenant_1", name: "Global", slug: "global", kind: "GLOBAL", active: true };
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ tenant: globalTenant }))), /Alleen CUSTOMER-tenants/);

  const users = [
    {
      id: "user_viewer",
      name: "Viewer",
      email: "viewer@example.test",
      passwordHash: "$2b$12$archived-password-hash",
      mustChangePassword: false,
      role: "VIEWER",
      provider: "LOCAL",
      active: true
    }
  ];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ users, roleAssignments: [] }))), /geen actieve ADMIN/);
});

test("lokale gebruikers vereisen een hash en e-mailadressen zijn uniek", () => {
  const users = [
    {
      id: "user_admin",
      name: "Tenant Admin",
      email: "admin@example.test",
      passwordHash: null,
      mustChangePassword: true,
      role: "ADMIN",
      provider: "LOCAL",
      active: true
    }
  ];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ users }))), /geen passwordHash/);

  const validUser = {
    ...users[0],
    passwordHash: "$2b$12$archived-password-hash"
  };
  const duplicate = {
    ...validUser,
    id: "user_other",
  };
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ users: [validUser, duplicate] }))), /dubbel.*e-mailadres/i);
});

test("RBAC-koppelingen blijven tenantgebonden en referentieel geldig", () => {
  const invalidAssignment = [{ userId: "user_admin", roleId: "missing_role" }];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ roleAssignments: invalidAssignment }))), /roltoewijzing buiten/);

  const roles = [
    {
      id: "role_admin",
      name: "Tenant Admin",
      description: null,
      system: true,
      permissionKeys: ["platform.settings.update"]
    }
  ];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ roles }))), /platformpermission/);
});

test("auditregels bewaren snapshots/hashvelden en vereisen canonieke tijdsvolgorde", () => {
  const auditLogs = [
    {
      id: "audit_1",
      tenantId: "tenant_1",
      tenantName: "Klanttenant",
      userId: "user_admin",
      actorName: "Tenant Admin",
      actorEmail: "admin@example.test",
      action: "customer.created",
      outcome: "success",
      entity: "Customer",
      entityId: "customer_1",
      metadata: null,
      ipAddress: "127.0.0.1",
      requestId: "request_1",
      previousHash: null,
      integrityHash: "a".repeat(64),
      createdAt: "2026-07-14T09:00:00.000Z"
    },
    {
      id: "audit_2",
      tenantId: "tenant_1",
      tenantName: "Klanttenant",
      userId: null,
      actorName: "Platform Admin",
      actorEmail: "platform@example.test",
      action: "tenant.opened",
      outcome: "success",
      entity: "Tenant",
      entityId: "tenant_1",
      metadata: null,
      ipAddress: null,
      requestId: "request_2",
      previousHash: "a".repeat(64),
      integrityHash: "c".repeat(64),
      createdAt: "2026-07-14T08:30:00.000Z"
    }
  ];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ auditLogs }))), /canonieke volgorde/i);
});

test("dubbele settings en ontbrekende klantmetadata worden voor enige mutatie geweigerd", () => {
  const settings = [
    { key: "mail.provider", value: "SMTP", encrypted: false },
    { key: "mail.provider", value: "MICROSOFT_GRAPH", encrypted: false }
  ];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ settings }))), /dubbel.*instellingssleutel/i);

  const customers = [{ id: "customer_1", name: "Acme", active: true, devices: [] }];
  assert.throws(() => tenantIdFromArchive(archiveFor(manifest({ customers }))), /Klantmetadata ontbreekt/);
});

test("archiefscope documenteert installatiebinding en sluit accounts en sessies uit", () => {
  assert.equal(TENANT_ARCHIVE_SCOPE.portability, "installation-bound");
  assert.ok(TENANT_ARCHIVE_SCOPE.included.includes("users-without-auth-sessions"));
  assert.ok(TENANT_ARCHIVE_SCOPE.included.includes("roles-and-permissions"));
  assert.ok(TENANT_ARCHIVE_SCOPE.included.includes("tenant-audit-log-with-snapshots"));
  assert.ok(TENANT_ARCHIVE_SCOPE.excluded.includes("accounts"));
  assert.ok(TENANT_ARCHIVE_SCOPE.excluded.includes("sessions"));
});
