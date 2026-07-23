"use server";

import { createHash, randomBytes } from "node:crypto";
import { BackupJobStatus, type Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auditLog } from "@/lib/audit";
import { stageBackupFiles } from "@/lib/backup-cleanup";
import { enqueueManualBackup } from "@/lib/backup-jobs";
import { inspectFortiGateCertificate, probeFortiGateConnection, type FortiGateCertificateInspection } from "@/lib/fortigate";
import { assertOperationalTenant, assertPermission, assertTenantAccess, isSuperAdmin, requirePermission, requireTenantUser } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertMailReady, sendMail } from "@/lib/mail";
import { assignDefaultTenantRole, ensureTenantRbac, permissions, type PermissionKey, userPermissionKeys } from "@/lib/rbac";
import { createSession, currentUser, destroySession, requireUser, setActiveTenantContext } from "@/lib/session";
import { applySettingMutations, type SettingMutation } from "@/lib/settings";
import { isItGlueEnabled } from "@/lib/itglue";
import { normalizeFortiGateBaseUrl } from "@/lib/network-safety";
import { isAutotaskEnabled } from "@/lib/autotask";
import { getTenantSiteUrl, normalizeSiteUrl } from "@/lib/site-url";
import { hashOneTimeToken, setupTokenCookieName } from "@/lib/setup-token";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { defaultTimeZone, isValidTimeZone } from "@/lib/time";
import { startAppUpdate } from "@/lib/app-update";
import { customerSchema, fortigateSchema, fortigateUpdateSchema, tenantSchema } from "@/lib/validators";

export type ActionState = {
  ok: boolean;
  message: string;
};

export type TenantUserCreateState = ActionState;
export type TenantUserUpdateState = ActionState;
export type AccessRoleCreateState = ActionState;
export type AccessRoleEditState = ActionState;
export type FortiGateCreateState = ActionState & {
  customerId?: string;
  deviceId?: string;
  certificate?: FortiGateCertificateInspection;
};

class FortiGateCertificateAcceptanceRequired extends Error {
  constructor(readonly certificate: FortiGateCertificateInspection) {
    super(certificate.selfSigned
      ? "De FortiGate gebruikt een self-signed certificaat. Controleer de gegevens en accepteer dit certificaat expliciet."
      : "Het FortiGate-certificaat kan niet worden gevalideerd. Controleer de gegevens en accepteer dit certificaat expliciet.");
  }
}

function bool(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function boolField(formData: FormData, name: string) {
  return formData.getAll(name).some((value) => value === "on" || value === "true");
}

async function withStagedBackupFiles(
  input: { deviceIds: string[]; filenames: Array<string | null> },
  mutation: () => Promise<void>
) {
  const staged = await stageBackupFiles(input);
  try {
    await mutation();
  } catch (error) {
    await staged.rollback();
    throw error;
  }
  await staged.commit().catch(() => undefined);
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const raw = String(value ?? "");
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

function managementEndpoint(managementUrl: string, httpsPort: number) {
  const url = new URL(managementUrl);
  return `${url.hostname.toLowerCase()}:${httpsPort}`;
}

async function loginThrottleKeys(email: string) {
  const requestHeaders = await headers();
  const ipAddress =
    requestHeaders
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ?? requestHeaders.get("x-real-ip") ?? "unknown";
  const normalizedEmail = email.trim().toLowerCase();
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  return {
    emailIp: `email-ip:${digest(`${normalizedEmail}\u0000${ipAddress}`)}`,
    email: `email:${digest(normalizedEmail)}`
  };
}

async function checkLoginThrottle(email: string) {
  const keys = await loginThrottleKeys(email);
  await prisma.loginThrottle.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
  });
  const attempts = await prisma.loginThrottle.findMany({
    where: { key: { in: [keys.emailIp, keys.email] }, lockedUntil: { gt: new Date() } },
    select: { key: true }
  });
  if (attempts.length) throw new Error("Te veel mislukte pogingen. Probeer het later opnieuw.");
  return keys;
}


function normalizeOptionalSiteUrl(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw ? normalizeSiteUrl(raw) : "";
}

function normalizeOptionalWebhookUrl(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is ongeldig.");
  }
  if (url.protocol !== "https:") throw new Error("Webhook URL moet met https:// beginnen.");
  return url.toString();
}

function normalizeEmailList(value: FormDataEntryValue | null) {
  const emails = String(value ?? "")
    .split(/[,\n;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const invalid = emails.find((email) => !email.includes("@"));
  if (invalid) throw new Error(`Ongeldig e-mailadres voor backup notificaties: ${invalid}`);
  return emails.join(", ");
}

function slugBaseFromName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tenant"
  );
}

async function createUniqueTenantSlug(name: string) {
  const base = slugBaseFromName(name);
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(24);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const reservedRoleNames = new Set(["super admin", "tenant admin", "operator", "backup operator", "auditor", "viewer"]);

function assertCustomRoleNameAvailable(name: string) {
  if (reservedRoleNames.has(name.trim().toLowerCase())) {
    throw new Error("Deze rolnaam is gereserveerd voor een systeemrol.");
  }
}

async function assertRoleManagementAccess(tenantId: string, action: "create" | "update" | "delete") {
  const user = await requireTenantUser();
  assertTenantAccess(user, tenantId);
  const permissionPrefix = (await isGlobalTenantId(tenantId)) ? "platform" : "tenant";
  await assertPermission(user, `${permissionPrefix}.roles.${action}` as PermissionKey);
  return user;
}

async function userManagementPermission(
  user: Awaited<ReturnType<typeof requireTenantUser>>,
  tenantId: string,
  action: "create" | "update" | "delete"
) {
  const permissionPrefix = (await isGlobalTenantId(tenantId)) ? "platform" : "tenant";
  return `${permissionPrefix}.users.${action}` as PermissionKey;
}

async function assertRoleCanBeAssigned(
  actor: Awaited<ReturnType<typeof requireTenantUser>>,
  role: { id: string; name: string; tenantId: string; system: boolean },
  target?: { id: string; role: "SUPER_ADMIN" | "ADMIN" | "VIEWER" }
) {
  const assignsSuperAdmin = role.system && role.name === "Super Admin";
  if (assignsSuperAdmin && !(await isGlobalTenantId(role.tenantId))) {
    throw new Error("De Super Admin-rol mag alleen binnen Global worden gebruikt.");
  }
  if (assignsSuperAdmin || target?.role === "SUPER_ADMIN") {
    if (!isSuperAdmin(actor)) throw new Error("Alleen een Super Admin kan de Super Admin-rol toekennen of intrekken.");
    await assertPermission(actor, "platform.super_admin.assign");
    if (target?.id === actor.id && !assignsSuperAdmin) {
      throw new Error("Je kunt je eigen Super Admin-rol niet via gebruikersbeheer intrekken.");
    }
  }

  const [actorKeys, assignedPermissions] = await Promise.all([
    userPermissionKeys(actor),
    prisma.accessRolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: { select: { key: true } } }
    })
  ]);
  const unauthorized = assignedPermissions.find(({ permission }) => !actorKeys.has(permission.key));
  if (unauthorized) throw new Error("Je kunt geen rol toekennen met rechten die je zelf niet hebt.");
}

async function assertCanManageSuperAdminTarget(
  actor: Awaited<ReturnType<typeof requireTenantUser>>,
  target: { role: "SUPER_ADMIN" | "ADMIN" | "VIEWER" }
) {
  if (target.role !== "SUPER_ADMIN") return;
  if (!isSuperAdmin(actor)) {
    throw new Error("Alleen een Super Admin kan een Super Admin beheren.");
  }
  await assertPermission(actor, "platform.super_admin.assign");
}

async function cleanupProvisionedTenant(input: { tenantId: string; setupTokenId?: string }) {
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { tenantId: input.tenantId } });
    const users = await tx.user.findMany({
      where: { tenantId: input.tenantId },
      select: { id: true }
    });
    const userIds = users.map(({ id }) => id);
    if (userIds.length) {
      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.account.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await tx.tenant.deleteMany({ where: { id: input.tenantId } });
    if (input.setupTokenId) {
      await tx.setupToken.updateMany({
        where: { id: input.setupTokenId, usedAt: { not: null } },
        data: { usedAt: null }
      });
    }
  });
}

async function filterGrantablePermissionKeys(
  actor: Awaited<ReturnType<typeof requireTenantUser>>,
  selectedKeys: string[],
  tenantId: string
) {
  const globalTenant = await isGlobalTenantId(tenantId);
  const catalogKeys = new Set<string>(
    permissions
      .filter((permission) => globalTenant || !permission.key.startsWith("platform."))
      .map((permission) => permission.key)
  );
  const actorKeys = await userPermissionKeys(actor);
  const requested = [...new Set(selectedKeys)];
  const invalid = requested.find((key) => !catalogKeys.has(key) || !actorKeys.has(key));
  if (invalid) throw new Error("Je kunt geen rechten toekennen die je zelf niet hebt.");
  if (requested.includes("platform.super_admin.assign") && !isSuperAdmin(actor)) {
    throw new Error("Alleen een Super Admin kan het recht om Super Admins te beheren delegeren.");
  }
  return requested as PermissionKey[];
}

function legacyRoleForAccessRole(role: { name: string; system: boolean }, globalTenant: boolean) {
  if (role.system && role.name === "Super Admin" && globalTenant) return "SUPER_ADMIN" as const;
  if (role.system && role.name === "Tenant Admin") return "ADMIN" as const;
  return "VIEWER" as const;
}

async function sendTemporaryPasswordMail(input: {
  tenantId?: string | null;
  siteTenantId?: string | null;
  tenantName: string;
  to: string;
  name: string;
  password: string;
}) {
  const siteUrl = await getTenantSiteUrl(input.siteTenantId ?? input.tenantId);
  const loginUrl = siteUrl ? `${siteUrl}/login` : null;
  await sendMail({
    tenantId: input.tenantId,
    to: input.to,
    subject: `FortiGate Backup toegang voor ${input.tenantName}`,
    text: [
      `Hallo ${input.name || input.to},`,
      "",
      `Er is een account voor je aangemaakt in de FortiGate Backup portal voor tenant ${input.tenantName}.`,
      "",
      ...(loginUrl ? [`Login URL: ${loginUrl}`, ""] : []),
      `Gebruikersnaam: ${input.to}`,
      `Tijdelijk wachtwoord: ${input.password}`,
      "",
      "Na het inloggen moet je direct een nieuw wachtwoord instellen."
    ].join("\n")
  });
}

async function onboardingMailTenantId() {
  return mainTenantId();
}

export async function switchTenantContextAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!user.tenantId || !(await isGlobalTenantId(user.tenantId))) {
    throw new Error("Alleen een gebruiker uit Global kan van tenantcontext wisselen.");
  }
  await assertPermission({ ...user, activeTenantId: user.tenantId }, "platform.tenants.switch");
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) throw new Error("Tenant is verplicht.");
  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { id: tenantId, active: true },
    select: { id: true, name: true }
  });
  await setActiveTenantContext(tenant.id);
  await auditLog({
    action: "tenant.access.entered",
    tenantId: tenant.id,
    userId: user.id,
    entity: "Tenant",
    entityId: tenant.id,
    metadata: { name: user.name, email: user.email, source: "tenant_switcher" }
  });
  revalidatePath("/", "layout");
  redirect("/");
}

async function recordLoginFailure(keys: Awaited<ReturnType<typeof loginThrottleKeys>>) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    for (const { key, limit } of [
      { key: keys.emailIp, limit: 8 },
      { key: keys.email, limit: 25 }
    ]) {
      const current = await tx.loginThrottle.findUnique({ where: { key } });
      const failures = current && current.updatedAt >= windowStart ? current.failures + 1 : 1;
      await tx.loginThrottle.upsert({
        where: { key },
        update: {
          failures,
          lockedUntil: failures >= limit ? new Date(now.getTime() + 10 * 60 * 1000) : null
        },
        create: {
          key,
          failures,
          lockedUntil: failures >= limit ? new Date(now.getTime() + 10 * 60 * 1000) : null
        }
      });
    }
  });
}

export async function createTenant(formData: FormData) {
  const existingTenants = await prisma.tenant.count();
  if (existingTenants > 0) {
    throw new Error("Setup is al uitgevoerd. Maak extra tenants aan via het Tenants menu.");
  }
  const name = "Global";
  const data = tenantSchema.parse({
    name,
    slug: await createUniqueTenantSlug(name),
    active: true
  });
  const setupCookieStore = await cookies();
  const setupToken = setupCookieStore.get(setupTokenCookieName)?.value ?? "";
  const email = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const password = String(formData.get("adminPassword") ?? "");
  const adminName = String(formData.get("adminName") ?? "").trim();
  if (!email.includes("@") || password.length < 12) {
    throw new Error("Admin e-mail en een wachtwoord van minimaal 12 tekens zijn verplicht.");
  }
  if (!setupToken) throw new Error("Deze setup-link is ongeldig of verlopen.");
  const passwordHash = await bcrypt.hash(password, 12);
  const { tenant, admin, setupTokenId } = await prisma.$transaction(async (tx) => {
    if ((await tx.tenant.count()) > 0) {
      throw new Error("Setup is al uitgevoerd. Maak extra tenants aan via het Tenants menu.");
    }
    const token = await tx.setupToken.findUnique({
      where: { tokenHash: hashOneTimeToken(setupToken) }
    });
    if (!token || token.usedAt || token.expires <= new Date()) {
      throw new Error("Deze setup-link is ongeldig of verlopen.");
    }
    const claimed = await tx.setupToken.updateMany({
      where: { id: token.id, usedAt: null, expires: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (claimed.count !== 1) throw new Error("Deze setup-link is al gebruikt.");
    const tenant = await tx.tenant.create({ data: { ...data, kind: "GLOBAL" } });
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name: adminName || "Super Admin",
        passwordHash,
        role: "SUPER_ADMIN",
        provider: "LOCAL"
      }
    });
    return { tenant, admin, setupTokenId: token.id };
  });
  try {
    await assignDefaultTenantRole(admin.id, tenant.id, admin.role);
    await auditLog({ action: "tenant.created", tenantId: tenant.id, userId: admin.id, entity: "Tenant", entityId: tenant.id });
    await auditLog({ action: "user.created", tenantId: tenant.id, userId: admin.id, entity: "User", entityId: admin.id });
    await createSession(admin.id);
  } catch (error) {
    await cleanupProvisionedTenant({ tenantId: tenant.id, setupTokenId });
    throw new Error("De eerste inrichting is teruggedraaid en kan opnieuw worden uitgevoerd.", { cause: error });
  }
  setupCookieStore.delete(setupTokenCookieName);
  revalidatePath("/");
  redirect("/");
}

export async function createManagedTenantWithState(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requirePermission("platform.tenants.create");
    const name = String(formData.get("name") ?? "");
    const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
    const adminPassword = generateTemporaryPassword();
    const adminName = String(formData.get("adminName") ?? "").trim();
    const portalSiteUrl = normalizeOptionalSiteUrl(formData.get("portal.siteUrl"));
    const data = tenantSchema.parse({
      name,
      slug: await createUniqueTenantSlug(name),
      active: true
    });

    if (!adminEmail) {
      return { ok: false, message: "Admin e-mail is verplicht." };
    }
    const mailTenantId = await onboardingMailTenantId();
    await assertMailReady(mailTenantId);

    const { tenant, admin } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { ...data, kind: "CUSTOMER" } });
      if (portalSiteUrl) {
        await tx.systemSetting.create({
          data: {
            tenantId: tenant.id,
            key: "portal.siteUrl",
            value: portalSiteUrl
          }
        });
      }
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: adminName || "Tenant Admin",
          email: adminEmail,
          passwordHash: await bcrypt.hash(adminPassword, 12),
          mustChangePassword: true,
          role: "ADMIN",
          provider: "LOCAL"
        }
      });
      return { tenant, admin };
    });

    try {
      await ensureTenantRbac(tenant.id);
      await assignDefaultTenantRole(admin.id, tenant.id, admin.role);
      await auditLog({ action: "tenant.created", tenantId: tenant.id, userId: user.id, entity: "Tenant", entityId: tenant.id });
      await auditLog({
        action: "user.created",
        tenantId: tenant.id,
        userId: user.id,
        entity: "User",
        entityId: admin.id,
        metadata: { email: admin.email, role: admin.role, mustChangePassword: true }
      });
      await auditLog({
        action: "user.temporary_password.dispatch_requested",
        tenantId: tenant.id,
        userId: user.id,
        entity: "User",
        entityId: admin.id,
        metadata: { email: admin.email }
      });
      revalidatePath("/tenants");
      await sendTemporaryPasswordMail({
        tenantId: mailTenantId,
        siteTenantId: tenant.id,
        tenantName: tenant.name,
        to: admin.email,
        name: admin.name ?? "",
        password: adminPassword
      });
    } catch (provisioningError) {
      await cleanupProvisionedTenant({ tenantId: tenant.id });
      revalidatePath("/tenants");
      return {
        ok: false,
        message: `Tenant is niet aangemaakt; alle provisioningwijzigingen zijn teruggedraaid: ${
          provisioningError instanceof Error ? provisioningError.message : "onbekende provisioningfout"
        }`
      };
    }
    return { ok: true, message: `Tenant ${tenant.name} is aangemaakt. Het tijdelijke wachtwoord is naar ${admin.email} verstuurd.` };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, message: "Deze tenant of dit admin e-mailadres bestaat al." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Tenant kon niet worden aangemaakt."
    };
  }
}

export async function createTenantUser(formData: FormData) {
  const user = await requireTenantUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleId = String(formData.get("roleId") ?? "");

  if (!tenantId) throw new Error("Tenant is verplicht.");
  if (!roleId) throw new Error("Rol is verplicht.");
  if (!email.includes("@")) throw new Error("Vul een geldig e-mailadres in.");
  assertTenantAccess(user, tenantId);
  await assertPermission(user, await userManagementPermission(user, tenantId, "create"));

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const temporaryPassword = generateTemporaryPassword();
  await ensureTenantRbac(tenant.id);
  const accessRole = await prisma.accessRole.findFirst({
    where: { id: roleId, tenantId: tenant.id },
    select: { id: true, name: true, tenantId: true, system: true }
  });
  if (!accessRole) throw new Error("De gekozen rol bestaat niet binnen deze tenant.");
  await assertRoleCanBeAssigned(user, accessRole);
  const legacyRole = legacyRoleForAccessRole(accessRole, await isGlobalTenantId(tenant.id));
  await assertMailReady(tenant.id);
  const created = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: name || null,
        email,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        mustChangePassword: true,
        role: legacyRole,
        provider: "LOCAL"
      }
    });
    await tx.userAccessRole.create({
      data: {
        userId: createdUser.id,
        roleId: accessRole.id
      }
    });
    return createdUser;
  });

  await auditLog({
    action: "user.created",
    tenantId: tenant.id,
    userId: user.id,
    entity: "User",
    entityId: created.id,
    metadata: { email: created.email, role: accessRole.name, roleId: accessRole.id, legacyRole: created.role }
  });
  try {
    await sendTemporaryPasswordMail({
      tenantId: tenant.id,
      tenantName: tenant.name,
      to: created.email,
      name: created.name ?? "",
      password: temporaryPassword
    });
  } catch (mailError) {
    await prisma.user.delete({ where: { id: created.id } });
    throw new Error(
      `Gebruiker is niet aangemaakt, omdat de mail met het tijdelijke wachtwoord niet kon worden verzonden: ${
        mailError instanceof Error ? mailError.message : "onbekende mailfout"
      }`
    );
  }
  await auditLog({
    action: "user.temporary_password.sent",
    tenantId: tenant.id,
    userId: user.id,
    entity: "User",
    entityId: created.id,
    metadata: { email: created.email }
  });
  revalidatePath("/tenants");
  revalidatePath("/users");
}

export async function createTenantUserWithState(_state: TenantUserCreateState, formData: FormData): Promise<TenantUserCreateState> {
  try {
    await createTenantUser(formData);
    return { ok: true, message: "Gebruiker is aangemaakt en het tijdelijke wachtwoord is gemaild." };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, message: "Er bestaat al een gebruiker met dit e-mailadres." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Gebruiker kon niet worden aangemaakt."
    };
  }
}

export async function updateTenantUserWithState(_state: TenantUserUpdateState, formData: FormData): Promise<TenantUserUpdateState> {
  try {
    const user = await requireTenantUser();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const roleId = String(formData.get("roleId") ?? "");
    if (!id || !roleId) return { ok: false, message: "Gebruiker en rol zijn verplicht." };
    if (!email.includes("@")) return { ok: false, message: "Vul een geldig e-mailadres in." };

    const target = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { accessRoles: { include: { role: true } } }
    });
    if (!target.tenantId) return { ok: false, message: "Deze gebruiker is niet aan een tenant gekoppeld." };
    assertTenantAccess(user, target.tenantId);
    await assertPermission(user, await userManagementPermission(user, target.tenantId, "update"));

    const accessRole = await prisma.accessRole.findFirst({
      where: { id: roleId, tenantId: target.tenantId },
      select: { id: true, name: true, tenantId: true, system: true }
    });
    if (!accessRole) return { ok: false, message: "De gekozen rol bestaat niet binnen deze tenant." };
    await assertRoleCanBeAssigned(user, accessRole, target);
    const legacyRole = legacyRoleForAccessRole(accessRole, await isGlobalTenantId(target.tenantId));
    const beforeRoles = target.accessRoles.map((assignment) => assignment.role.name);

    await prisma.$transaction(async (tx) => {
      await assertUserRoleChangeSafe(tx, target.id, target.tenantId!, legacyRole);
      await tx.user.update({
        where: { id: target.id },
        data: { name: name || null, email, role: legacyRole }
      });
      await tx.userAccessRole.deleteMany({ where: { userId: target.id } });
      await tx.userAccessRole.create({ data: { userId: target.id, roleId: accessRole.id } });
    });
    await auditLog({
      action: "user.updated",
      tenantId: target.tenantId,
      userId: user.id,
      entity: "User",
      entityId: target.id,
      metadata: { beforeEmail: target.email, afterEmail: email, beforeRoles, afterRole: accessRole.name }
    });
    revalidatePath("/users");
    revalidatePath("/tenants");
    return { ok: true, message: "Gebruiker is bijgewerkt." };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, message: "Er bestaat al een gebruiker met dit e-mailadres." };
    return { ok: false, message: error instanceof Error ? error.message : "Gebruiker kon niet worden bijgewerkt." };
  }
}

export async function setTenantUserActive(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "");
  const active = bool(formData.get("active"));
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (!target.tenantId) throw new Error("Deze gebruiker is niet aan een tenant gekoppeld.");
  if (target.id === user.id && !active) throw new Error("Je kunt je eigen account niet deactiveren.");
  assertTenantAccess(user, target.tenantId);
  await assertPermission(user, await userManagementPermission(user, target.tenantId, "update"));
  await assertCanManageSuperAdminTarget(user, target);
  await prisma.$transaction(async (tx) => {
    if (!active) await assertUserCanBeRemovedOrDisabled(tx, target);
    await tx.user.update({ where: { id: target.id }, data: { active } });
    if (!active) await tx.session.deleteMany({ where: { userId: target.id } });
  });
  await auditLog({
    action: active ? "user.activated" : "user.deactivated",
    tenantId: target.tenantId,
    userId: user.id,
    entity: "User",
    entityId: target.id,
    metadata: { email: target.email }
  });
  revalidatePath("/users");
  revalidatePath("/tenants");
}

export async function resetTenantUserPassword(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { tenant: { select: { id: true, name: true } } }
  });
  if (!target.tenantId || !target.tenant) throw new Error("Deze gebruiker is niet aan een tenant gekoppeld.");
  if (!target.active) throw new Error("Wachtwoord resetten kan alleen voor actieve gebruikers.");
  if (target.provider === "ENTRA") throw new Error("Dit account gebruikt Microsoft Entra ID en heeft geen lokaal wachtwoord om te resetten.");
  assertTenantAccess(user, target.tenantId);
  await assertPermission(user, await userManagementPermission(user, target.tenantId, "update"));
  await assertCanManageSuperAdminTarget(user, target);
  await assertMailReady(target.tenantId);

  const temporaryPassword = generateTemporaryPassword();
  const previousPasswordState = {
    passwordHash: target.passwordHash,
    mustChangePassword: target.mustChangePassword,
    provider: target.provider
  };
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      mustChangePassword: true
    }
  });
  await prisma.session.deleteMany({ where: { userId: target.id } });

  try {
    await sendTemporaryPasswordMail({
      tenantId: target.tenantId,
      tenantName: target.tenant.name,
      to: target.email,
      name: target.name ?? "",
      password: temporaryPassword
    });
  } catch (mailError) {
    await prisma.user.update({ where: { id: target.id }, data: previousPasswordState });
    throw new Error(
      `Het wachtwoord is niet gewijzigd, omdat de mail met het tijdelijke wachtwoord niet kon worden verzonden: ${
        mailError instanceof Error ? mailError.message : "onbekende mailfout"
      }`
    );
  }

  await auditLog({
    action: "user.password_reset",
    tenantId: target.tenantId,
    userId: user.id,
    entity: "User",
    entityId: target.id,
    metadata: { email: target.email, mustChangePassword: true }
  });
  revalidatePath("/users");
}

async function assertUserRoleChangeSafe(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
  nextRole: "SUPER_ADMIN" | "ADMIN" | "VIEWER"
) {
  const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if ((current.role === "ADMIN" || current.role === "SUPER_ADMIN") && nextRole === "VIEWER") {
    const tenantAdmins = await tx.user.count({
      where: { tenantId, active: true, role: { in: ["ADMIN", "SUPER_ADMIN"] }, id: { not: userId } }
    });
    if (tenantAdmins < 1) throw new Error("De laatste beheerder van deze tenant kan niet worden aangepast naar een niet-beheerrol.");
  }
  if (current.role === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN") {
    const superAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN", active: true, id: { not: userId } } });
    if (superAdmins < 1) throw new Error("De laatste superadmin kan niet worden aangepast.");
  }
}

async function assertUserCanBeRemovedOrDisabled(
  tx: Prisma.TransactionClient,
  target: { id: string; tenantId: string | null; role: "SUPER_ADMIN" | "ADMIN" | "VIEWER"; active: boolean }
) {
  if (!target.tenantId) throw new Error("Deze gebruiker is niet aan een tenant gekoppeld.");
  const tenantUsers = await tx.user.count({ where: { tenantId: target.tenantId, active: true, id: { not: target.id } } });
  if (tenantUsers < 1) throw new Error("De laatste gebruiker van een tenant kan niet los verwijderd of gedeactiveerd worden.");
  if (target.role === "SUPER_ADMIN") {
    const superAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN", active: true, id: { not: target.id } } });
    if (superAdmins < 1) throw new Error("De laatste superadmin kan niet verwijderd of gedeactiveerd worden.");
  }
  if (target.role === "ADMIN" || target.role === "SUPER_ADMIN") {
    const tenantAdmins = await tx.user.count({
      where: { tenantId: target.tenantId, active: true, role: { in: ["ADMIN", "SUPER_ADMIN"] }, id: { not: target.id } }
    });
    if (tenantAdmins < 1) throw new Error("De laatste beheerder van deze tenant kan niet verwijderd of gedeactiveerd worden.");
  }
}

export async function createAccessRoleWithState(_state: AccessRoleCreateState, formData: FormData): Promise<AccessRoleCreateState> {
  try {
    const tenantId = String(formData.get("tenantId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const selectedKeys = formData.getAll("permissionKeys").map(String);

    if (!tenantId) return { ok: false, message: "Tenant is verplicht." };
    if (name.length < 2) return { ok: false, message: "Rolnaam moet minimaal 2 tekens bevatten." };
    assertCustomRoleNameAvailable(name);
    const user = await assertRoleManagementAccess(tenantId, "create");
    const permissionKeys = await filterGrantablePermissionKeys(user, selectedKeys, tenantId);
    await ensureTenantRbac(tenantId);

    const permissionRecords = permissionKeys.length
      ? await prisma.accessPermission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true } })
      : [];
    const role = await prisma.accessRole.create({
      data: {
        tenantId,
        name,
        description: description || null,
        system: false,
        permissions: {
          create: permissionRecords.map((permission) => ({
            permission: { connect: { id: permission.id } }
          }))
        }
      }
    });
    await auditLog({
      action: "role.created",
      tenantId,
      userId: user.id,
      entity: "AccessRole",
      entityId: role.id,
      metadata: { name, permissions: permissionKeys.length, addedPermissions: permissionKeys }
    });
    revalidatePath("/roles");
    return { ok: true, message: `Rol ${name} is aangemaakt.` };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, message: "Er bestaat al een rol met deze naam binnen deze tenant." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Rol kon niet worden aangemaakt."
    };
  }
}

export async function updateAccessRoleWithState(_state: AccessRoleEditState, formData: FormData): Promise<AccessRoleEditState> {
  try {
    const roleId = String(formData.get("roleId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const selectedKeys = formData.getAll("permissionKeys").map(String);
    if (!roleId) return { ok: false, message: "Rol is verplicht." };
    if (name.length < 2) return { ok: false, message: "Rolnaam moet minimaal 2 tekens bevatten." };
    assertCustomRoleNameAvailable(name);

    const role = await prisma.accessRole.findUniqueOrThrow({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } }
    });
    if (role.system) return { ok: false, message: "Systeemrollen kunnen niet worden aangepast." };
    const user = await assertRoleManagementAccess(role.tenantId, "update");
    const permissionKeys = await filterGrantablePermissionKeys(user, selectedKeys, role.tenantId);
    const beforeKeys = role.permissions.map(({ permission }) => permission.key);
    const addedPermissions = permissionKeys.filter((key) => !beforeKeys.includes(key));
    const permissionKeySet = new Set<string>(permissionKeys);
    const removedPermissions = beforeKeys.filter((key) => !permissionKeySet.has(key));
    const permissionRecords = permissionKeys.length
      ? await prisma.accessPermission.findMany({ where: { key: { in: permissionKeys } } })
      : [];

    await prisma.$transaction(async (tx) => {
      await tx.accessRole.update({
        where: { id: role.id },
        data: { name, description: description || null }
      });
      await tx.accessRolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissionRecords.length) {
        await tx.accessRolePermission.createMany({
          data: permissionRecords.map((permission) => ({ roleId: role.id, permissionId: permission.id }))
        });
      }
    });
    await auditLog({
      action: "role.updated",
      tenantId: role.tenantId,
      userId: user.id,
      entity: "AccessRole",
      entityId: role.id,
      metadata: {
        beforeName: role.name,
        afterName: name,
        addedPermissions,
        removedPermissions
      }
    });
    revalidatePath("/roles");
    return { ok: true, message: `Rol ${name} is bijgewerkt.` };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, message: "Er bestaat al een rol met deze naam binnen deze tenant." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Rol kon niet worden bijgewerkt."
    };
  }
}

export async function deleteAccessRole(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) throw new Error("Rol is verplicht.");
  const role = await prisma.accessRole.findUniqueOrThrow({
    where: { id: roleId },
    include: { _count: { select: { users: true } } }
  });
  const user = await assertRoleManagementAccess(role.tenantId, "delete");
  if (role.system) throw new Error("Systeemrollen kunnen niet worden verwijderd.");
  await prisma.$transaction(async (tx) => {
    const members = await tx.userAccessRole.count({ where: { roleId: role.id } });
    if (members > 0) throw new Error("Deze rol kan pas worden verwijderd wanneer er geen leden meer aan gekoppeld zijn.");
    await tx.accessRole.delete({ where: { id: role.id } });
  });
  await auditLog({
    action: "role.deleted",
    tenantId: role.tenantId,
    userId: user.id,
    entity: "AccessRole",
    entityId: role.id,
    metadata: { name: role.name }
  });
  revalidatePath("/roles");
}

export async function deleteTenantUser(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { tenant: true }
  });

  if (target.id === user.id) {
    throw new Error("Je kunt je eigen gebruiker niet verwijderen.");
  }
  if (!target.tenantId) {
    throw new Error("Deze gebruiker is niet aan een tenant gekoppeld.");
  }
  assertTenantAccess(user, target.tenantId);
  await assertPermission(user, await userManagementPermission(user, target.tenantId, "delete"));
  await assertCanManageSuperAdminTarget(user, target);
  await prisma.$transaction(async (tx) => {
    await assertUserCanBeRemovedOrDisabled(tx, target);
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.account.deleteMany({ where: { userId: target.id } });
    await tx.user.delete({ where: { id: target.id } });
  });
  await auditLog({
    action: "user.deleted",
    tenantId: target.tenantId,
    userId: user.id,
    entity: "User",
    entityId: target.id,
    metadata: { email: target.email, role: target.role }
  });

  revalidatePath("/tenants");
  revalidatePath("/users");
}

export async function setTenantActive(formData: FormData) {
  const user = await requirePermission("platform.tenants.update");
  const id = String(formData.get("id"));
  const active = bool(formData.get("active"));
  const mainTenant = await mainTenantId();
  if (!active && mainTenant === id) {
    throw new Error("Global kan niet gedeactiveerd worden.");
  }
  const tenant = await prisma.tenant.update({ where: { id }, data: { active } });
  await auditLog({
    action: active ? "tenant.activated" : "tenant.deactivated",
    tenantId: tenant.id,
    userId: user.id,
    entity: "Tenant",
    entityId: tenant.id
  });
  revalidatePath("/tenants");
}

export async function updateTenant(formData: FormData) {
  const user = await requirePermission("platform.tenants.update");
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) throw new Error("De tenantnaam moet tussen 2 en 120 tekens lang zijn.");
  const before = await prisma.tenant.findUniqueOrThrow({ where: { id }, select: { id: true, name: true } });
  const tenant = await prisma.tenant.update({ where: { id }, data: { name } });
  await auditLog({ action: "tenant.updated", tenantId: tenant.id, userId: user.id, entity: "Tenant", entityId: tenant.id, metadata: { beforeName: before.name, afterName: tenant.name } });
  revalidatePath("/tenants");
  revalidatePath("/");
}

export async function deleteTenant(formData: FormData) {
  const user = await requirePermission("platform.tenants.delete");
  const id = String(formData.get("id"));
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim();
  const [tenant, mainTenant] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        customers: {
          include: {
            devices: {
              include: {
                backups: { select: { filename: true } }
              }
            }
          }
        },
        _count: { select: { customers: true, users: true } }
      }
    }),
    mainTenantId()
  ]);

  if (mainTenant === tenant.id) {
    throw new Error("Global kan niet verwijderd worden.");
  }
  if (confirmName !== tenant.name) {
    throw new Error("Bevestiging mislukt. Typ de tenantnaam exact over.");
  }
  if (confirmDelete !== "Delete") {
    throw new Error('Bevestiging mislukt. Typ exact "Delete" om de tenant definitief te verwijderen.');
  }

  const devices = tenant.customers.flatMap((customer) => customer.devices);
  await withStagedBackupFiles(
    {
      deviceIds: devices.map((device) => device.id),
      filenames: devices.flatMap((device) => device.backups.map((backup) => backup.filename))
    },
    async () => {
      await prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
        const userIds = users.map((item) => item.id);
        if (userIds.length) {
          await tx.session.deleteMany({ where: { userId: { in: userIds } } });
          await tx.account.deleteMany({ where: { userId: { in: userIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await tx.tenant.delete({ where: { id: tenant.id } });
      });
    }
  );
  await auditLog({
    action: "tenant.deleted",
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: user.id,
    entity: "Tenant",
    entityId: tenant.id,
    metadata: {
      name: tenant.name,
      slug: tenant.slug,
      customers: tenant._count.customers,
      users: tenant._count.users
    }
  });

  revalidatePath("/tenants");
  revalidatePath("/customers");
}

export type LoginState = { error?: string };

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const genericError = "De opgegeven gegevens zijn niet juist.";
  let throttleKeys: Awaited<ReturnType<typeof loginThrottleKeys>>;
  try {
    throttleKeys = await checkLoginThrottle(email);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Te veel mislukte pogingen. Probeer het later opnieuw."
    };
  }
  const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  if (!user?.passwordHash || !user.active) {
    await recordLoginFailure(throttleKeys);
    await auditLog({
      action: "auth.login.failed",
      tenantId: user?.tenantId,
      userId: user?.id,
      entity: "User",
      entityId: user?.id,
      outcome: "failure",
      reason: "invalid_credentials"
    });
    return { error: genericError };
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordLoginFailure(throttleKeys);
    await auditLog({
      action: "auth.login.failed",
      tenantId: user.tenantId,
      userId: user.id,
      entity: "User",
      entityId: user.id,
      outcome: "failure",
      reason: "invalid_credentials"
    });
    return { error: genericError };
  }
  if (!isSuperAdmin(user) && !user.tenant?.active) {
    await auditLog({
      action: "auth.login.denied",
      tenantId: user.tenantId,
      userId: user.id,
      entity: "User",
      entityId: user.id,
      outcome: "denied",
      reason: "tenant_inactive"
    });
    return { error: genericError };
  }
  await prisma.loginThrottle.deleteMany({ where: { key: { in: [throttleKeys.emailIp, throttleKeys.email] } } });
  await createSession(user.id);
  await auditLog({ action: "auth.login", tenantId: user.tenantId, userId: user.id, entity: "User", entityId: user.id });
  if (user.mustChangePassword) redirect("/change-password");
  redirect("/");
}

export type ChangePasswordState = {
  ok: boolean;
  message: string;
};

export async function changeOwnPasswordAction(_state: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const user = await requireUser({ allowPasswordChange: true });
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!isSuperAdmin(user) && !user.tenantId) redirect("/login");
  if (!user.passwordHash) return { ok: false, message: "Dit account gebruikt geen lokaal wachtwoord." };
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return { ok: false, message: "Het huidige wachtwoord klopt niet." };
  }
  if (password.length < 12) {
    return { ok: false, message: "Het nieuwe wachtwoord moet minimaal 12 tekens zijn." };
  }
  if (password !== confirmPassword) {
    return { ok: false, message: "De nieuwe wachtwoorden komen niet overeen." };
  }
  if (await bcrypt.compare(password, user.passwordHash)) {
    return { ok: false, message: "Kies een ander wachtwoord dan het tijdelijke wachtwoord." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false }
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
  });
  await createSession(user.id);
  await auditLog({ action: "user.password_changed", tenantId: user.tenantId, userId: user.id, entity: "User", entityId: user.id });
  revalidatePath("/");
  redirect("/");
}

export async function logoutAction() {
  const user = await currentUser();
  if (user) {
    await auditLog({ action: "auth.logout", tenantId: user.activeTenantId ?? user.tenantId, userId: user.id, entity: "User", entityId: user.id });
  }
  await destroySession();
  redirect("/login");
}

export async function createCustomer(formData: FormData) {
  const user = await requireTenantUser();
  const data = customerSchema.parse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    contact: formData.get("contact") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
    itGlueOrganizationId: formData.get("itGlueOrganizationId") || undefined,
    autotaskCompanyId: formData.get("autotaskCompanyId") || undefined,
    active: true
  });
  assertTenantAccess(user, data.tenantId);
  await assertOperationalTenant(user, data.tenantId);
  await assertPermission(user, "customers.create");
  if ((await isItGlueEnabled(data.tenantId)) && !data.itGlueOrganizationId) {
    throw new Error("IT Glue organization ID is verplicht wanneer IT Glue actief is voor deze tenant.");
  }
  if ((await isAutotaskEnabled(data.tenantId)) && !data.autotaskCompanyId) {
    throw new Error("Autotask Company ID is verplicht wanneer Autotask actief is voor deze tenant.");
  }
  const customer = await prisma.customer.create({ data });
  await auditLog({
    action: "customer.created",
    tenantId: customer.tenantId,
    userId: user.id,
    entity: "Customer",
    entityId: customer.id
  });
  revalidatePath("/customers");
}

export async function updateCustomer(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const existing = await prisma.customer.findUniqueOrThrow({ where: { id } });
  const data = customerSchema.parse({
    tenantId: existing.tenantId,
    name: formData.get("name"),
    contact: formData.get("contact") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
    itGlueOrganizationId: formData.get("itGlueOrganizationId") || undefined,
    autotaskCompanyId: formData.get("autotaskCompanyId") || undefined,
    active: existing.active
  });
  assertTenantAccess(user, existing.tenantId);
  await assertOperationalTenant(user, existing.tenantId);
  await assertPermission(user, "customers.update");
  if ((await isItGlueEnabled(existing.tenantId)) && !data.itGlueOrganizationId) {
    throw new Error("IT Glue organization ID is verplicht wanneer IT Glue actief is voor deze tenant.");
  }
  if ((await isAutotaskEnabled(existing.tenantId)) && !data.autotaskCompanyId) {
    throw new Error("Autotask Company ID is verplicht wanneer Autotask actief is voor deze tenant.");
  }
  const customer = await prisma.customer.update({ where: { id }, data });
  await auditLog({
    action: "customer.updated",
    tenantId: customer.tenantId,
    userId: user.id,
    entity: "Customer",
    entityId: customer.id,
    metadata: {
      before: {
        name: existing.name,
        itGlueOrganizationId: existing.itGlueOrganizationId,
        autotaskCompanyId: existing.autotaskCompanyId
      },
      after: {
        name: customer.name,
        itGlueOrganizationId: customer.itGlueOrganizationId,
        autotaskCompanyId: customer.autotaskCompanyId
      }
    }
  });
  revalidatePath("/customers");
  revalidatePath(`/customers/${customer.id}`);
}

export async function deleteCustomer(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id },
    include: {
      devices: {
        include: {
          backups: { select: { filename: true } }
        }
      }
    }
  });
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);
  await assertPermission(user, "customers.delete");
  if (confirmName !== customer.name) {
    throw new Error("Bevestiging mislukt. Typ de klantnaam exact over.");
  }

  await withStagedBackupFiles(
    {
      deviceIds: customer.devices.map((device) => device.id),
      filenames: customer.devices.flatMap((device) => device.backups.map((backup) => backup.filename))
    },
    async () => {
      await prisma.customer.delete({ where: { id: customer.id } });
    }
  );
  await auditLog({
    action: "customer.deleted",
    tenantId: customer.tenantId,
    userId: user.id,
    entity: "Customer",
    entityId: customer.id,
    metadata: {
      name: customer.name,
      devices: customer.devices.length,
      backupFiles: customer.devices.reduce((count, device) => count + device.backups.filter((backup) => backup.filename).length, 0)
    }
  });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function createFortiGate(formData: FormData) {
  const user = await requireTenantUser();
  const parsed = fortigateSchema.parse({
    customerId: formData.get("customerId"),
    managementUrl: formData.get("managementUrl"),
    httpsPort: formData.get("httpsPort"),
    apiToken: formData.get("apiToken"),
    tlsVerify: boolField(formData, "tlsVerify"),
    vdom: formData.get("vdom") || undefined,
    scheduleType: formData.get("scheduleType") || "DAILY",
    cronExpression: formData.get("cronExpression") || undefined,
    itGlueConfigurationId: formData.get("itGlueConfigurationId") || undefined
  });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: parsed.customerId } });
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);
  await assertPermission(user, "fortigates.create");
  if ((await isItGlueEnabled(customer.tenantId)) && !parsed.itGlueConfigurationId) {
    throw new Error("IT Glue configuration ID is verplicht wanneer IT Glue actief is voor deze tenant.");
  }
  normalizeFortiGateBaseUrl(parsed.managementUrl, parsed.httpsPort, parsed.tlsVerify);
  const certificate = await inspectFortiGateCertificate(parsed.managementUrl, parsed.httpsPort);
  const acceptedFingerprint = String(formData.get("acceptedTlsFingerprint") ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (!certificate.trusted && acceptedFingerprint !== certificate.fingerprint) {
    throw new FortiGateCertificateAcceptanceRequired(certificate);
  }
  const apiTokenEncrypted = encryptSecret(parsed.apiToken);
  const inventory = await probeFortiGateConnection({
    managementUrl: parsed.managementUrl,
    httpsPort: parsed.httpsPort,
    tlsVerify: parsed.tlsVerify,
    tlsCertificateFingerprint: certificate.trusted ? null : certificate.fingerprint,
    apiTokenEncrypted
  });
  const device = await prisma.fortiGate.create({
    data: {
      customerId: parsed.customerId,
      managementUrl: parsed.managementUrl,
      httpsPort: parsed.httpsPort,
      apiTokenEncrypted,
      tlsVerify: parsed.tlsVerify,
      tlsCertificateFingerprint: certificate.trusted ? null : certificate.fingerprint,
      tlsCertificateSubject: certificate.subject,
      tlsCertificateIssuer: certificate.issuer,
      tlsCertificateValidFrom: new Date(certificate.validFrom),
      tlsCertificateValidTo: new Date(certificate.validTo),
      tlsCertificateAcceptedAt: certificate.trusted ? null : new Date(),
      vdom: parsed.vdom,
      scheduleType: parsed.scheduleType,
      cronExpression: parsed.cronExpression,
      itGlueConfigurationId: parsed.itGlueConfigurationId,
      hostname: inventory.hostname,
      serialNumber: inventory.serialNumber,
      model: inventory.model,
      firmwareVersion: inventory.firmwareVersion,
      firmwareBuild: inventory.firmwareBuild,
      uptime: inventory.uptime,
      lastCheckedAt: new Date()
    },
    include: { customer: true }
  });
  await auditLog({
    action: "fortigate.created",
    tenantId: device.customer.tenantId,
    userId: user.id,
    entity: "FortiGate",
    entityId: device.id
  });
  revalidatePath(`/customers/${device.customerId}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}`);
  return { customerId: device.customerId, deviceId: device.id };
}

export async function createFortiGateWithState(_state: FortiGateCreateState, formData: FormData): Promise<FortiGateCreateState> {
  try {
    const device = await createFortiGate(formData);
    return { ok: true, message: "FortiGate is opgeslagen.", ...device };
  } catch (error) {
    if (error instanceof FortiGateCertificateAcceptanceRequired) {
      return { ok: false, message: error.message, certificate: error.certificate };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "FortiGate kon niet worden opgeslagen."
    };
  }
}

export async function acceptFortiGateCertificate(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "");
  const expectedFingerprint = String(formData.get("fingerprint") ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (!boolField(formData, "acceptCertificate")) throw new Error("Bevestig expliciet dat je dit specifieke certificaat accepteert.");
  const device = await prisma.fortiGate.findUniqueOrThrow({ where: { id }, include: { customer: true } });
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  await assertPermission(user, "fortigates.update");
  const certificate = await inspectFortiGateCertificate(device.managementUrl, device.httpsPort);
  if (certificate.trusted) throw new Error("Het certificaat is inmiddels geldig en hoeft niet handmatig geaccepteerd te worden.");
  if (certificate.fingerprint !== expectedFingerprint) {
    throw new Error("Het FortiGate-certificaat veranderde tijdens de controle. Vernieuw de pagina en controleer het nieuwe certificaat.");
  }
  await prisma.fortiGate.update({
    where: { id: device.id },
    data: {
      tlsVerify: true,
      tlsCertificateFingerprint: certificate.fingerprint,
      tlsCertificateSubject: certificate.subject,
      tlsCertificateIssuer: certificate.issuer,
      tlsCertificateValidFrom: new Date(certificate.validFrom),
      tlsCertificateValidTo: new Date(certificate.validTo),
      tlsCertificateAcceptedAt: new Date()
    }
  });
  await auditLog({
    action: "fortigate.certificate.accepted",
    tenantId: device.customer.tenantId,
    userId: user.id,
    entity: "FortiGate",
    entityId: device.id,
    metadata: { fingerprint: certificate.fingerprint, selfSigned: certificate.selfSigned, validationError: certificate.validationError }
  });
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}`);
  redirect(`/customers/${device.customerId}/fortigates/${device.id}`);
}

export async function updateFortiGate(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const existing = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  assertTenantAccess(user, existing.customer.tenantId);
  await assertOperationalTenant(user, existing.customer.tenantId);
  await assertPermission(user, "fortigates.update");
  const parsed = fortigateUpdateSchema.parse({
    customerId: formData.get("customerId"),
    managementUrl: formData.get("managementUrl"),
    httpsPort: formData.get("httpsPort"),
    apiToken: formData.get("apiToken") || undefined,
    tlsVerify: boolField(formData, "tlsVerify"),
    vdom: formData.get("vdom") || undefined,
    scheduleType: formData.get("scheduleType") || "DAILY",
    cronExpression: formData.get("cronExpression") || undefined,
    itGlueConfigurationId: formData.get("itGlueConfigurationId") || undefined
  });
  normalizeFortiGateBaseUrl(parsed.managementUrl, parsed.httpsPort, parsed.tlsVerify);
  const endpointChanged = managementEndpoint(existing.managementUrl, existing.httpsPort) !== managementEndpoint(parsed.managementUrl, parsed.httpsPort);
  if (endpointChanged && !parsed.apiToken) {
    throw new Error("Vul het API-token opnieuw in wanneer de FortiGate host of HTTPS-poort wijzigt.");
  }
  const apiTokenEncrypted = parsed.apiToken ? encryptSecret(parsed.apiToken) : null;
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: parsed.customerId } });
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);
  if ((await isItGlueEnabled(customer.tenantId)) && !parsed.itGlueConfigurationId) {
    throw new Error("IT Glue configuration ID is verplicht wanneer IT Glue actief is voor deze tenant.");
  }

  const device = await prisma.fortiGate.update({
    where: { id },
    data: {
      customerId: parsed.customerId,
      managementUrl: parsed.managementUrl,
      httpsPort: parsed.httpsPort,
      ...(apiTokenEncrypted ? { apiTokenEncrypted } : {}),
      tlsVerify: parsed.tlsVerify,
      ...(endpointChanged ? {
        tlsCertificateFingerprint: null,
        tlsCertificateSubject: null,
        tlsCertificateIssuer: null,
        tlsCertificateValidFrom: null,
        tlsCertificateValidTo: null,
        tlsCertificateAcceptedAt: null
      } : {}),
      vdom: parsed.vdom,
      scheduleType: parsed.scheduleType,
      ...(parsed.scheduleType !== existing.scheduleType ? { nextRunAt: null } : {}),
      cronExpression: parsed.cronExpression,
      itGlueConfigurationId: parsed.itGlueConfigurationId
    },
    include: { customer: true }
  });
  await auditLog({
    action: "fortigate.updated",
    tenantId: device.customer.tenantId,
    userId: user.id,
    entity: "FortiGate",
    entityId: device.id,
    metadata: { tokenUpdated: Boolean(parsed.apiToken) }
  });
  revalidatePath(`/customers/${device.customerId}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}`);
  redirect(safeReturnTo(formData.get("returnTo"), `/customers/${device.customerId}/fortigates/${device.id}`));
}

export async function deleteFortiGate(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: {
      customer: true,
      backups: { select: { filename: true } }
    }
  });
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  await assertPermission(user, "fortigates.delete");
  await withStagedBackupFiles(
    {
      deviceIds: [device.id],
      filenames: device.backups.map((backup) => backup.filename)
    },
    async () => {
      await prisma.fortiGate.delete({ where: { id } });
    }
  );
  await auditLog({
    action: "fortigate.deleted",
    tenantId: device.customer.tenantId,
    userId: user.id,
    entity: "FortiGate",
    entityId: device.id,
    metadata: {
      customerId: device.customerId,
      managementUrl: device.managementUrl,
      hostname: device.hostname,
      serialNumber: device.serialNumber
    }
  });
  revalidatePath("/customers");
  revalidatePath(`/customers/${device.customerId}`);
  redirect(safeReturnTo(formData.get("returnTo"), `/customers/${device.customerId}`));
}

export async function runBackupAction(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  await assertPermission(user, "fortigates.backup.run");
  const queued = await enqueueManualBackup({ fortigateId: device.id, tenantId: device.customer.tenantId, userId: user.id });
  await auditLog({
    action: queued.created ? "backup.job.queued" : "backup.job.already_queued",
    tenantId: device.customer.tenantId,
    userId: user.id,
    entity: "BackupJob",
    entityId: queued.job.id,
    metadata: { fortigateId: device.id, status: queued.job.status }
  });
  revalidatePath(`/customers/${device.customerId}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}/backups`);
  redirect(safeReturnTo(formData.get("returnTo"), `/customers/${device.customerId}/fortigates/${device.id}`));
}

export async function runQueuedBackupNowAction(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "").trim();
  const job = await prisma.backupJob.findUnique({ where: { id }, select: { id: true, tenantId: true, fortigateId: true, status: true } });
  if (!job) throw new Error("De backuptaak bestaat niet meer.");
  await assertOperationalTenant(user, job.tenantId);
  await assertPermission(user, "fortigates.backup.run");
  if (job.status !== BackupJobStatus.PENDING) throw new Error("Alleen wachtende backuptaken kunnen direct worden gestart.");

  const result = await prisma.backupJob.updateMany({
    where: { id: job.id, tenantId: job.tenantId, status: BackupJobStatus.PENDING },
    data: { availableAt: new Date(), error: null }
  });
  if (result.count !== 1) throw new Error("De taakstatus is ondertussen gewijzigd. Vernieuw de queue.");

  await auditLog({
    action: "backup.job.expedited",
    tenantId: job.tenantId,
    userId: user.id,
    entity: "BackupJob",
    entityId: job.id,
    metadata: { fortigateId: job.fortigateId }
  });
  revalidatePath("/queue");
  redirect("/queue");
}

export async function cancelQueuedBackupAction(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "").trim();
  const job = await prisma.backupJob.findUnique({ where: { id }, select: { id: true, tenantId: true, fortigateId: true, status: true } });
  if (!job) throw new Error("De backuptaak bestaat niet meer.");
  await assertOperationalTenant(user, job.tenantId);
  await assertPermission(user, "fortigates.backup.run");
  if (job.status !== BackupJobStatus.PENDING) throw new Error("Alleen wachtende backuptaken kunnen worden geannuleerd.");
  const result = await prisma.backupJob.deleteMany({ where: { id: job.id, tenantId: job.tenantId, status: BackupJobStatus.PENDING } });
  if (result.count !== 1) throw new Error("De taakstatus is ondertussen gewijzigd. Vernieuw de queue.");
  await auditLog({ action: "backup.job.cancelled", tenantId: job.tenantId, userId: user.id, entity: "BackupJob", entityId: job.id, metadata: { fortigateId: job.fortigateId } });
  revalidatePath("/queue");
  redirect("/queue");
}

export async function retryFailedBackupAction(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id") ?? "").trim();
  const job = await prisma.backupJob.findUnique({
    where: { id },
    select: { id: true, tenantId: true, fortigateId: true, status: true, attempts: true }
  });
  if (!job) throw new Error("De backuptaak bestaat niet meer.");
  await assertOperationalTenant(user, job.tenantId);
  await assertPermission(user, "fortigates.backup.run");
  if (job.status !== BackupJobStatus.FAILED) throw new Error("Alleen definitief mislukte backuptaken kunnen opnieuw worden geprobeerd.");

  const result = await prisma.backupJob.updateMany({
    where: { id: job.id, tenantId: job.tenantId, status: BackupJobStatus.FAILED },
    data: {
      status: BackupJobStatus.PENDING,
      attempts: 0,
      availableAt: new Date(),
      startedAt: null,
      finishedAt: null,
      error: null,
      requestedByUserId: user.id
    }
  });
  if (result.count !== 1) throw new Error("De taakstatus is ondertussen gewijzigd. Vernieuw de queue.");

  await auditLog({
    action: "backup.job.retried",
    tenantId: job.tenantId,
    userId: user.id,
    entity: "BackupJob",
    entityId: job.id,
    metadata: { fortigateId: job.fortigateId, previousAttempts: job.attempts }
  });
  revalidatePath("/queue");
  redirect("/queue");
}

async function settingsTenantFromForm(
  user: Awaited<ReturnType<typeof requireTenantUser>>,
  formData: FormData
) {
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) throw new Error("De configuratiescope ontbreekt. Vernieuw de pagina en probeer opnieuw.");

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, active: true },
    select: { id: true, kind: true }
  });
  if (!tenant) throw new Error("De gekozen configuratiescope bestaat niet of is niet actief.");

  const actorBelongsToGlobal = Boolean(user.tenantId && (await isGlobalTenantId(user.tenantId)));
  if (user.breakGlassSettingsOnly) {
    if (!actorBelongsToGlobal || tenant.kind !== "GLOBAL") {
      throw new Error("Break-glass toegang mag alleen Global-instellingen wijzigen.");
    }
  } else if ((user.activeTenantId ?? user.tenantId) !== tenant.id) {
    throw new Error("Geen toegang tot deze configuratiescope.");
  }

  return tenant.id;
}

async function assertSettingsMutationAccess(
  user: Awaited<ReturnType<typeof requireTenantUser>>,
  tenantId: string | null,
  formData: FormData
) {
  if (user.breakGlassSettingsOnly) return;
  const keys = [...formData.keys()].filter((key) => key !== "tenantId" && key !== "mail.testTo");
  const required = new Set<PermissionKey>();
  const includesPrefix = (...prefixes: string[]) => keys.some((key) => prefixes.some((prefix) => key.startsWith(prefix)));

  if (includesPrefix("portal.", "ui.", "scheduler.", "backup.")) {
    required.add((await isGlobalTenantId(tenantId)) ? "platform.settings.update" : "tenant.settings.update");
  }
  if (includesPrefix("mail.", "smtp.", "graph.")) required.add("integrations.mail.update");
  if (includesPrefix("itglue.")) required.add("integrations.itglue.update");
  if (includesPrefix("autotask.")) required.add("integrations.autotask.update");
  if (includesPrefix("entra.")) required.add("integrations.sso.update");
  if (!required.size) throw new Error("Er zijn geen geldige instellingen aangeleverd.");
  for (const permission of required) await assertPermission(user, permission);
}

function validateIntegerSetting(formData: FormData, key: string, minimum: number, maximum: number) {
  if (!formData.has(key) || !formData.get(key)) return;
  const value = Number(formData.get(key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} moet een geheel getal tussen ${minimum} en ${maximum} zijn.`);
  }
}

async function validateSettingsForm(formData: FormData, tenantId: string | null) {
  const provider = formData.get("mail.provider");
  if (provider && !new Set(["SMTP", "MICROSOFT_GRAPH", "SYSTEM"]).has(String(provider))) {
    throw new Error("Onbekende mailprovider.");
  }
  if (provider === "SYSTEM" && (await isGlobalTenantId(tenantId))) {
    throw new Error("Global kan niet naar zijn eigen systeemmailinstellingen verwijzen.");
  }
  validateIntegerSetting(formData, "smtp.port", 1, 65535);
  validateIntegerSetting(formData, "scheduler.maxParallelJobs", 1, 100);
  validateIntegerSetting(formData, "backup.retention.count", 1, 10000);
  validateIntegerSetting(formData, "backup.retry.count", 0, 10);
  const schedule = formData.get("backup.defaultSchedule");
  if (schedule && !new Set(["MANUAL", "HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).has(String(schedule))) {
    throw new Error("Ongeldig standaard backupschema.");
  }
}

export async function saveSettings(formData: FormData) {
  const user = await requireTenantUser({ allowBreakGlassSettingsOnly: true });
  if (user.breakGlassSettingsOnly) {
    const allowedFields = new Set(["tenantId", "entra.enabled", "entra.tenantId", "entra.clientId", "entra.clientSecret"]);
    for (const key of formData.keys()) {
      if (!allowedFields.has(key)) throw new Error("Break-glass toegang mag alleen SSO instellingen wijzigen.");
    }
  }
  const tenantId = await settingsTenantFromForm(user, formData);
  const scopedUser = { ...user, activeTenantId: tenantId };
  await assertSettingsMutationAccess(scopedUser, tenantId, formData);
  await validateSettingsForm(formData, tenantId);
  const mutations: SettingMutation[] = [];
  const setValue = (key: string, value: string, encrypted = false) =>
    mutations.push({ operation: "set", key, value, tenantId, encrypted });
  const removeValue = (key: string) => mutations.push({ operation: "delete", key, tenantId });
  const portalSiteUrl = normalizeOptionalSiteUrl(formData.get("portal.siteUrl"));
  if (formData.has("portal.siteUrl")) {
    if (portalSiteUrl) setValue("portal.siteUrl", portalSiteUrl);
    else removeValue("portal.siteUrl");
  }
  if (formData.has("ui.timeZone")) {
    const timeZone = String(formData.get("ui.timeZone") || defaultTimeZone);
    if (!isValidTimeZone(timeZone)) throw new Error("Ongeldige tijdzone.");
    setValue("ui.timeZone", timeZone);
  }
  const backupNotifyRecipients = normalizeEmailList(formData.get("backup.notifyRecipients"));
  const backupWebhookUrl = normalizeOptionalWebhookUrl(formData.get("backup.webhookUrl"));
  const entries = [
    ["itglue.baseUrl", formData.get("itglue.baseUrl")],
    ["autotask.baseUrl", formData.get("autotask.baseUrl")],
    ["autotask.username", formData.get("autotask.username")],
    ["autotask.queueId", formData.get("autotask.queueId")],
    ["autotask.priorityId", formData.get("autotask.priorityId")],
    ["autotask.workTypeId", formData.get("autotask.workTypeId")],
    ["autotask.statusId", formData.get("autotask.statusId")],
    ["autotask.sourceId", formData.get("autotask.sourceId")],
    ["autotask.issueTypeId", formData.get("autotask.issueTypeId")],
    ["autotask.subIssueTypeId", formData.get("autotask.subIssueTypeId")],
    ["mail.provider", formData.get("mail.provider")],
    ["smtp.host", formData.get("smtp.host")],
    ["smtp.port", formData.get("smtp.port")],
    ["smtp.user", formData.get("smtp.user")],
    ["smtp.from", formData.get("smtp.from")],
    ["graph.from", formData.get("graph.from")],
    ["graph.tenantId", formData.get("graph.tenantId")],
    ["graph.clientId", formData.get("graph.clientId")],
    ["entra.tenantId", formData.get("entra.tenantId")],
    ["entra.clientId", formData.get("entra.clientId")],
    ["scheduler.maxParallelJobs", formData.get("scheduler.maxParallelJobs")],
    ["backup.defaultSchedule", formData.get("backup.defaultSchedule")],
    ["backup.retention.count", formData.get("backup.retention.count")],
    ["backup.retry.count", formData.get("backup.retry.count")],
    ["backup.notifyRecipients", backupNotifyRecipients],
    ["backup.webhookUrl", backupWebhookUrl]
  ] as const;
  if (formData.has("backup.notifyEmail") || formData.has("backup.notifyWebhook") || formData.has("backup.notifyAutotask")) {
    const notificationEventsEnabled =
      boolField(formData, "backup.notifySuccess") || boolField(formData, "backup.notifyFailures");
    if (notificationEventsEnabled && boolField(formData, "backup.notifyEmail") && !backupNotifyRecipients) {
      throw new Error("Vul minimaal een mailontvanger in voor backup notificaties.");
    }
    if (notificationEventsEnabled && boolField(formData, "backup.notifyWebhook") && !backupWebhookUrl) {
      throw new Error("Vul een webhook URL in voor backup notificaties.");
    }
    if (notificationEventsEnabled && boolField(formData, "backup.notifyAutotask")) {
      if (!formData.get("autotask.queueId") || !formData.get("autotask.priorityId")) {
        throw new Error("Vul een Autotask queue en priority in voor backup tickets.");
      }
    }
  }
  if (formData.has("itglue.enabled")) {
    setValue("itglue.enabled", boolField(formData, "itglue.enabled") ? "true" : "false");
  }
  if (formData.has("autotask.enabled")) {
    setValue("autotask.enabled", boolField(formData, "autotask.enabled") ? "true" : "false");
  }
  if (formData.has("entra.enabled")) {
    setValue("entra.enabled", boolField(formData, "entra.enabled") ? "true" : "false");
  }
  if (formData.has("scheduler.enabled")) {
    setValue("scheduler.enabled", boolField(formData, "scheduler.enabled") ? "true" : "false");
  }
  if (formData.has("backup.schedule.enabled")) {
    setValue("backup.schedule.enabled", boolField(formData, "backup.schedule.enabled") ? "true" : "false");
  }
  if (formData.has("backup.notifyFailures")) {
    setValue("backup.notifyFailures", boolField(formData, "backup.notifyFailures") ? "true" : "false");
  }
  if (formData.has("backup.notifySuccess")) {
    setValue("backup.notifySuccess", boolField(formData, "backup.notifySuccess") ? "true" : "false");
  }
  if (formData.has("backup.notifyEmail")) {
    setValue("backup.notifyEmail", boolField(formData, "backup.notifyEmail") ? "true" : "false");
  }
  if (formData.has("backup.notifyWebhook")) {
    setValue("backup.notifyWebhook", boolField(formData, "backup.notifyWebhook") ? "true" : "false");
  }
  if (formData.has("backup.notifyAutotask")) {
    setValue("backup.notifyAutotask", boolField(formData, "backup.notifyAutotask") ? "true" : "false");
  }
  for (const [key, value] of entries) {
    if (!formData.has(key)) continue;
    if (value) setValue(key, String(value));
    else removeValue(key);
  }
  const smtpPassword = formData.get("smtp.password");
  const itGlueApiKey = formData.get("itglue.apiKey");
  const autotaskIntegrationCode = formData.get("autotask.integrationCode");
  const autotaskSecret = formData.get("autotask.secret");
  const graphToken = formData.get("graph.accessToken");
  const graphClientSecret = formData.get("graph.clientSecret");
  const entraSecret = formData.get("entra.clientSecret");
  if (smtpPassword) setValue("smtp.password", String(smtpPassword), true);
  if (itGlueApiKey) setValue("itglue.apiKey", String(itGlueApiKey), true);
  if (autotaskIntegrationCode) setValue("autotask.integrationCode", String(autotaskIntegrationCode), true);
  if (autotaskSecret) setValue("autotask.secret", String(autotaskSecret), true);
  if (graphToken) setValue("graph.accessToken", String(graphToken), true);
  if (graphClientSecret) setValue("graph.clientSecret", String(graphClientSecret), true);
  if (entraSecret) setValue("entra.clientSecret", String(entraSecret), true);
  for (const key of ["smtp.password", "itglue.apiKey", "autotask.integrationCode", "autotask.secret", "graph.accessToken", "graph.clientSecret", "entra.clientSecret"]) {
    if (boolField(formData, `${key}.clear`)) removeValue(key);
  }
  await applySettingMutations(mutations);
  await auditLog({ action: "settings.updated", tenantId, userId: user.id });
  revalidatePath("/settings");
}




export async function startAppUpdateAction(formData: FormData) {
  const user = await requirePermission("platform.updates.run");
  const result = await startAppUpdate({
    userId: user.id,
    returnTo: safeReturnTo(formData.get("returnTo"), "/settings?tab=updates")
  });
  const globalTenantId = await mainTenantId();
  await auditLog({
    action: "app.update.started",
    tenantId: globalTenantId,
    userId: user.id,
    entity: "System",
    metadata: result
  });
  revalidatePath("/");
  revalidatePath("/settings");
}

export type MailTestState = {
  ok: boolean;
  message: string;
};

export async function testMailSettings(_state: MailTestState, formData: FormData): Promise<MailTestState> {
  const to = String(formData.get("mail.testTo") || "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { ok: false, message: "Vul een geldig test e-mailadres in." };
  }

  try {
    const user = await requireTenantUser();
    const tenantId = await settingsTenantFromForm(user, formData);
    const scopedUser = { ...user, activeTenantId: tenantId };
    await assertPermission(scopedUser, "integrations.mail.test");
    await assertMailReady(tenantId);

    await sendMail({
      tenantId,
      to,
      subject: "FortiGate Backup mailtest",
      text: "Deze testmail bevestigt dat de mailconfiguratie correct werkt."
    });

    await auditLog({ action: "settings.mail_test.sent", tenantId, userId: user.id, metadata: { to } });
    revalidatePath("/settings");
    return { ok: true, message: `Testmail verzonden naar ${to}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Testmail kon niet worden verzonden."
    };
  }
}
