"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auditLog } from "@/lib/audit";
import { removeBackupFiles } from "@/lib/backup-cleanup";
import { assertOperationalTenant, assertPermission, assertTenantAccess, isSuperAdmin, requireSuperAdmin, requireTenantUser } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { runBackup } from "@/lib/fortigate";
import { assertMailReady, sendMail } from "@/lib/mail";
import { assignDefaultTenantRole, ensureTenantRbac, permissions, type PermissionKey } from "@/lib/rbac";
import { createSession, destroySession, requireUser, setActiveTenantContext } from "@/lib/session";
import { deleteSetting, setSetting } from "@/lib/settings";
import { isItGlueEnabled } from "@/lib/itglue";
import { getTenantSiteUrl, normalizeSiteUrl } from "@/lib/site-url";
import { mainTenantId } from "@/lib/tenant-main";
import { defaultTimeZone, isValidTimeZone } from "@/lib/time";
import { startAppUpdate } from "@/lib/app-update";
import { customerSchema, fortigateSchema, fortigateUpdateSchema, tenantSchema } from "@/lib/validators";

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

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
};

function bool(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function boolField(formData: FormData, name: string) {
  return formData.getAll(name).some((value) => value === "on" || value === "true");
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const raw = String(value ?? "");
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

function checkLoginThrottle(email: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    throw new Error("Te veel mislukte pogingen. Probeer het later opnieuw.");
  }
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

async function assertRoleManagementAccess(tenantId: string, action: "create" | "update" | "delete") {
  const user = await requireTenantUser();
  assertTenantAccess(user, tenantId);
  const globalTenantId = await mainTenantId();
  const permissionPrefix = isSuperAdmin(user) && tenantId === globalTenantId ? "platform" : "tenant";
  await assertPermission(user, `${permissionPrefix}.roles.${action}` as PermissionKey);
  return user;
}

async function userManagementPermission(
  user: Awaited<ReturnType<typeof requireTenantUser>>,
  tenantId: string,
  action: "create" | "update" | "delete"
) {
  const globalTenantId = await mainTenantId();
  const permissionPrefix = isSuperAdmin(user) && tenantId === globalTenantId ? "platform" : "tenant";
  return `${permissionPrefix}.users.${action}` as PermissionKey;
}

async function sendTemporaryPasswordMail(input: {
  tenantId?: string | null;
  tenantName: string;
  to: string;
  name: string;
  password: string;
}) {
  const siteUrl = await getTenantSiteUrl(input.tenantId);
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
  const user = await requireSuperAdmin();
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

function recordLoginFailure(email: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  const lockExpired = attempt?.lockedUntil ? attempt.lockedUntil < now : false;
  const count = attempt && !lockExpired ? attempt.count + 1 : 1;
  loginAttempts.set(email, {
    count,
    lockedUntil: count >= 5 ? now + 1000 * 60 * 15 : 0
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
    active: bool(formData.get("active"))
  });
  const email = String(formData.get("adminEmail") ?? "");
  const password = String(formData.get("adminPassword") ?? "");
  if (!email || password.length < 12) {
    throw new Error("Admin e-mail en een wachtwoord van minimaal 12 tekens zijn verplicht.");
  }
  const tenant = await prisma.tenant.create({ data });
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name: String(formData.get("adminName") ?? "Super Admin"),
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      provider: "LOCAL"
    }
  });
  await auditLog({ action: "tenant.created", tenantId: tenant.id, entity: "Tenant", entityId: tenant.id });
  await auditLog({ action: "user.created", tenantId: tenant.id, entity: "User", entityId: admin.id });
  await assignDefaultTenantRole(admin.id, tenant.id, admin.role);
  await createSession(admin.id);
  revalidatePath("/");
  redirect("/");
}

export async function createManagedTenant(formData: FormData) {
  const user = await requireSuperAdmin();
  const name = String(formData.get("name") ?? "");
  const data = tenantSchema.parse({
    name,
    slug: await createUniqueTenantSlug(name),
    active: true
  });
  const adminEmail = String(formData.get("adminEmail") ?? "").toLowerCase();
  const adminPassword = generateTemporaryPassword();
  const adminName = String(formData.get("adminName") ?? "");
  const portalSiteUrl = normalizeOptionalSiteUrl(formData.get("portal.siteUrl"));
  if (!adminEmail) {
    throw new Error("Admin e-mail is verplicht.");
  }
  const mailTenantId = await onboardingMailTenantId();
  await assertMailReady(mailTenantId);

  const tenant = await prisma.tenant.create({ data });
  if (portalSiteUrl) {
    await setSetting("portal.siteUrl", portalSiteUrl, { tenantId: tenant.id });
  }
  const admin = await prisma.user.create({
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
  await auditLog({
    action: "tenant.created",
    tenantId: tenant.id,
    userId: user.id,
    entity: "Tenant",
    entityId: tenant.id
  });
  await auditLog({
    action: "user.created",
    tenantId: tenant.id,
    userId: user.id,
    entity: "User",
    entityId: admin.id
  });
  await assignDefaultTenantRole(admin.id, tenant.id, admin.role);
  try {
    await sendTemporaryPasswordMail({
      tenantId: mailTenantId,
      tenantName: tenant.name,
      to: admin.email,
      name: admin.name ?? "",
      password: adminPassword
    });
  } catch (mailError) {
    await prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { id: admin.id } });
      await tx.tenant.delete({ where: { id: tenant.id } });
    });
    throw new Error(
      `Tenant is niet aangemaakt, omdat de mail met het tijdelijke wachtwoord niet kon worden verzonden: ${
        mailError instanceof Error ? mailError.message : "onbekende mailfout"
      }`
    );
  }
  revalidatePath("/tenants");
}

export async function createManagedTenantWithState(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireSuperAdmin();
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
      const tenant = await tx.tenant.create({ data });
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

    await auditLog({
      action: "tenant.created",
      tenantId: tenant.id,
      userId: user.id,
      entity: "Tenant",
      entityId: tenant.id
    });
    await auditLog({
      action: "user.created",
      tenantId: tenant.id,
      userId: user.id,
      entity: "User",
      entityId: admin.id,
      metadata: { email: admin.email, role: admin.role, mustChangePassword: true }
    });
    await ensureTenantRbac(tenant.id);
    await assignDefaultTenantRole(admin.id, tenant.id, admin.role);

    try {
      await sendTemporaryPasswordMail({
        tenantId: mailTenantId,
        tenantName: tenant.name,
        to: admin.email,
        name: admin.name ?? "",
        password: adminPassword
      });
      await auditLog({
        action: "user.temporary_password.sent",
        tenantId: tenant.id,
        userId: user.id,
        entity: "User",
        entityId: admin.id,
        metadata: { email: admin.email }
      });
    } catch (mailError) {
      await prisma.$transaction(async (tx) => {
        await tx.user.deleteMany({ where: { id: admin.id } });
        await tx.tenant.delete({ where: { id: tenant.id } });
      });
      revalidatePath("/tenants");
      return {
        ok: false,
        message: `Tenant is niet aangemaakt, omdat de mail met het tijdelijke wachtwoord niet kon worden verzonden: ${
          mailError instanceof Error ? mailError.message : "onbekende mailfout"
        }`
      };
    }

    revalidatePath("/tenants");
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
    select: { id: true, name: true }
  });
  if (!accessRole) throw new Error("De gekozen rol bestaat niet binnen deze tenant.");
  const legacyRole =
    accessRole.name === "Super Admin" && tenant.id === (await mainTenantId())
      ? "SUPER_ADMIN"
      : accessRole.name === "Tenant Admin"
        ? "ADMIN"
        : "VIEWER";
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
      select: { id: true, name: true }
    });
    if (!accessRole) return { ok: false, message: "De gekozen rol bestaat niet binnen deze tenant." };
    const legacyRole =
      accessRole.name === "Super Admin" && target.tenantId === (await mainTenantId())
        ? "SUPER_ADMIN"
        : accessRole.name === "Tenant Admin"
          ? "ADMIN"
          : "VIEWER";
    await assertUserRoleChangeSafe(target.id, target.tenantId, legacyRole);
    const beforeRoles = target.accessRoles.map((assignment) => assignment.role.name);

    await prisma.$transaction(async (tx) => {
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
  if (!active) await assertUserCanBeRemovedOrDisabled(target);
  await prisma.user.update({ where: { id: target.id }, data: { active } });
  if (!active) await prisma.session.deleteMany({ where: { userId: target.id } });
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
  assertTenantAccess(user, target.tenantId);
  await assertPermission(user, await userManagementPermission(user, target.tenantId, "update"));
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
      mustChangePassword: true,
      provider: "LOCAL"
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

async function assertUserRoleChangeSafe(userId: string, tenantId: string, nextRole: "SUPER_ADMIN" | "ADMIN" | "VIEWER") {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if ((current.role === "ADMIN" || current.role === "SUPER_ADMIN") && nextRole === "VIEWER") {
    const tenantAdmins = await prisma.user.count({
      where: { tenantId, active: true, role: { in: ["ADMIN", "SUPER_ADMIN"] }, id: { not: userId } }
    });
    if (tenantAdmins < 1) throw new Error("De laatste beheerder van deze tenant kan niet worden aangepast naar een niet-beheerrol.");
  }
  if (current.role === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN") {
    const superAdmins = await prisma.user.count({ where: { role: "SUPER_ADMIN", active: true, id: { not: userId } } });
    if (superAdmins < 1) throw new Error("De laatste superadmin kan niet worden aangepast.");
  }
}

async function assertUserCanBeRemovedOrDisabled(target: { id: string; tenantId: string | null; role: "SUPER_ADMIN" | "ADMIN" | "VIEWER"; active: boolean }) {
  if (!target.tenantId) throw new Error("Deze gebruiker is niet aan een tenant gekoppeld.");
  const tenantUsers = await prisma.user.count({ where: { tenantId: target.tenantId, active: true, id: { not: target.id } } });
  if (tenantUsers < 1) throw new Error("De laatste gebruiker van een tenant kan niet los verwijderd of gedeactiveerd worden.");
  if (target.role === "SUPER_ADMIN") {
    const superAdmins = await prisma.user.count({ where: { role: "SUPER_ADMIN", active: true, id: { not: target.id } } });
    if (superAdmins < 1) throw new Error("De laatste superadmin kan niet verwijderd of gedeactiveerd worden.");
  }
  if (target.role === "ADMIN" || target.role === "SUPER_ADMIN") {
    const tenantAdmins = await prisma.user.count({
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
    const user = await assertRoleManagementAccess(tenantId, "create");
    const globalTenantId = await mainTenantId();
    const allowedKeys = new Set<string>(
      permissions
        .filter((permission) => tenantId === globalTenantId || !permission.key.startsWith("platform."))
        .map((permission) => permission.key)
    );
    const permissionKeys = [...new Set(selectedKeys)].filter((key) => allowedKeys.has(key));
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

    const role = await prisma.accessRole.findUniqueOrThrow({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } }
    });
    if (role.system) return { ok: false, message: "Systeemrollen kunnen niet worden aangepast." };
    const user = await assertRoleManagementAccess(role.tenantId, "update");
    const globalTenantId = await mainTenantId();
    const allowedKeys = new Set<string>(
      permissions
        .filter((permission) => role.tenantId === globalTenantId || !permission.key.startsWith("platform."))
        .map((permission) => permission.key)
    );
    const permissionKeys = [...new Set(selectedKeys)].filter((key) => allowedKeys.has(key));
    const beforeKeys = role.permissions.map(({ permission }) => permission.key);
    const addedPermissions = permissionKeys.filter((key) => !beforeKeys.includes(key));
    const removedPermissions = beforeKeys.filter((key) => !permissionKeys.includes(key));
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
  if (role._count.users > 0) throw new Error("Deze rol kan pas worden verwijderd wanneer er geen leden meer aan gekoppeld zijn.");

  await prisma.accessRole.delete({ where: { id: role.id } });
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
  await assertUserCanBeRemovedOrDisabled(target);

  await auditLog({
    action: "user.deleted",
    tenantId: target.tenantId,
    userId: user.id,
    entity: "User",
    entityId: target.id,
    metadata: { email: target.email, role: target.role }
  });

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.account.deleteMany({ where: { userId: target.id } });
    await tx.user.delete({ where: { id: target.id } });
  });

  revalidatePath("/tenants");
  revalidatePath("/users");
}

export async function setTenantActive(formData: FormData) {
  const user = await requireSuperAdmin();
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
export async function deleteTenant(formData: FormData) {
  const user = await requireSuperAdmin();
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

  await auditLog({
    action: "tenant.deleted",
    tenantId: tenant.id,
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

  const devices = tenant.customers.flatMap((customer) => customer.devices);
  await removeBackupFiles({
    deviceIds: devices.map((device) => device.id),
    filenames: devices.flatMap((device) => device.backups.map((backup) => backup.filename))
  });

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

  revalidatePath("/tenants");
  revalidatePath("/customers");
}

export type LoginState = { error?: string };

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const genericError = "De opgegeven gegevens zijn niet juist.";
  try {
    checkLoginThrottle(email);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Te veel mislukte pogingen. Probeer het later opnieuw."
    };
  }
  const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  if (!user?.passwordHash || !user.active) {
    if (email) recordLoginFailure(email);
    return { error: genericError };
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordLoginFailure(email);
    return { error: genericError };
  }
  if (!isSuperAdmin(user) && !user.tenant?.active) {
    return { error: genericError };
  }
  loginAttempts.delete(email);
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

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      mustChangePassword: false
    }
  });
  await auditLog({ action: "user.password_changed", tenantId: user.tenantId, userId: user.id, entity: "User", entityId: user.id });
  revalidatePath("/");
  redirect("/");
}

export async function logoutAction() {
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
    active: true
  });
  assertTenantAccess(user, data.tenantId);
  await assertOperationalTenant(user, data.tenantId);
  await assertPermission(user, "customers.create");
  if ((await isItGlueEnabled(data.tenantId)) && !data.itGlueOrganizationId) {
    throw new Error("IT Glue organization ID is verplicht wanneer IT Glue actief is voor deze tenant.");
  }
  const customer = await prisma.customer.create({ data });
  await auditLog({
    action: "customer.created",
    tenantId: customer.tenantId,
    entity: "Customer",
    entityId: customer.id
  });
  revalidatePath("/customers");
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

  await removeBackupFiles({
    deviceIds: customer.devices.map((device) => device.id),
    filenames: customer.devices.flatMap((device) => device.backups.map((backup) => backup.filename))
  });

  await prisma.customer.delete({ where: { id: customer.id } });
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
  const device = await prisma.fortiGate.create({
    data: {
      customerId: parsed.customerId,
      managementUrl: parsed.managementUrl,
      httpsPort: parsed.httpsPort,
      apiTokenEncrypted: encryptSecret(parsed.apiToken),
      tlsVerify: parsed.tlsVerify,
      vdom: parsed.vdom,
      scheduleType: parsed.scheduleType,
      cronExpression: parsed.cronExpression,
      itGlueConfigurationId: parsed.itGlueConfigurationId
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
    return {
      ok: false,
      message: error instanceof Error ? error.message : "FortiGate kon niet worden opgeslagen."
    };
  }
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
      ...(parsed.apiToken ? { apiTokenEncrypted: encryptSecret(parsed.apiToken) } : {}),
      tlsVerify: parsed.tlsVerify,
      vdom: parsed.vdom,
      scheduleType: parsed.scheduleType,
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
  await removeBackupFiles({
    deviceIds: [device.id],
    filenames: device.backups.map((backup) => backup.filename)
  });
  await prisma.fortiGate.delete({ where: { id } });
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
  await runBackup(id);
  revalidatePath(`/customers/${device.customerId}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}`);
  revalidatePath(`/customers/${device.customerId}/fortigates/${device.id}/backups`);
}

export async function saveSettings(formData: FormData) {
  const user = await requireTenantUser();
  const tenantId = isSuperAdmin(user) ? user.activeTenantId ?? (await mainTenantId()) : user.tenantId;
  const portalSiteUrl = normalizeOptionalSiteUrl(formData.get("portal.siteUrl"));
  if (formData.has("portal.siteUrl")) {
    if (portalSiteUrl) await setSetting("portal.siteUrl", portalSiteUrl, { tenantId });
    else await deleteSetting("portal.siteUrl", tenantId);
  }
  if (formData.has("ui.timeZone")) {
    const timeZone = String(formData.get("ui.timeZone") || defaultTimeZone);
    if (!isValidTimeZone(timeZone)) throw new Error("Ongeldige tijdzone.");
    await setSetting("ui.timeZone", timeZone, { tenantId });
  }
  const backupNotifyRecipients = normalizeEmailList(formData.get("backup.notifyRecipients"));
  const backupWebhookUrl = normalizeOptionalWebhookUrl(formData.get("backup.webhookUrl"));
  const entries = [
    ["itglue.baseUrl", formData.get("itglue.baseUrl")],
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
  if (formData.has("backup.notifyEmail") || formData.has("backup.notifyWebhook")) {
    const notificationEventsEnabled =
      boolField(formData, "backup.notifySuccess") || boolField(formData, "backup.notifyFailures");
    if (notificationEventsEnabled && boolField(formData, "backup.notifyEmail") && !backupNotifyRecipients) {
      throw new Error("Vul minimaal een mailontvanger in voor backup notificaties.");
    }
    if (notificationEventsEnabled && boolField(formData, "backup.notifyWebhook") && !backupWebhookUrl) {
      throw new Error("Vul een webhook URL in voor backup notificaties.");
    }
  }
  if (formData.has("itglue.enabled")) {
    await setSetting("itglue.enabled", boolField(formData, "itglue.enabled") ? "true" : "false", { tenantId });
  }
  if (formData.has("entra.enabled")) {
    await setSetting("entra.enabled", boolField(formData, "entra.enabled") ? "true" : "false", { tenantId });
  }
  if (formData.has("scheduler.enabled")) {
    await setSetting("scheduler.enabled", boolField(formData, "scheduler.enabled") ? "true" : "false", { tenantId });
  }
  if (formData.has("backup.schedule.enabled")) {
    await setSetting("backup.schedule.enabled", boolField(formData, "backup.schedule.enabled") ? "true" : "false", { tenantId });
  }
  if (formData.has("backup.notifyFailures")) {
    await setSetting("backup.notifyFailures", boolField(formData, "backup.notifyFailures") ? "true" : "false", { tenantId });
  }
  if (formData.has("backup.notifySuccess")) {
    await setSetting("backup.notifySuccess", boolField(formData, "backup.notifySuccess") ? "true" : "false", { tenantId });
  }
  if (formData.has("backup.notifyEmail")) {
    await setSetting("backup.notifyEmail", boolField(formData, "backup.notifyEmail") ? "true" : "false", { tenantId });
  }
  if (formData.has("backup.notifyWebhook")) {
    await setSetting("backup.notifyWebhook", boolField(formData, "backup.notifyWebhook") ? "true" : "false", { tenantId });
  }
  for (const [key, value] of entries) {
    if (value) await setSetting(key, String(value), { tenantId });
  }
  if (formData.has("backup.notifyRecipients") && !backupNotifyRecipients) {
    await deleteSetting("backup.notifyRecipients", tenantId);
  }
  if (formData.has("backup.webhookUrl") && !backupWebhookUrl) {
    await deleteSetting("backup.webhookUrl", tenantId);
  }
  const smtpPassword = formData.get("smtp.password");
  const itGlueApiKey = formData.get("itglue.apiKey");
  const graphToken = formData.get("graph.accessToken");
  const graphClientSecret = formData.get("graph.clientSecret");
  const entraSecret = formData.get("entra.clientSecret");
  if (smtpPassword) await setSetting("smtp.password", String(smtpPassword), { tenantId, encrypted: true });
  if (itGlueApiKey) await setSetting("itglue.apiKey", String(itGlueApiKey), { tenantId, encrypted: true });
  if (graphToken) await setSetting("graph.accessToken", String(graphToken), { tenantId, encrypted: true });
  if (graphClientSecret) await setSetting("graph.clientSecret", String(graphClientSecret), { tenantId, encrypted: true });
  if (entraSecret) await setSetting("entra.clientSecret", String(entraSecret), { tenantId, encrypted: true });
  await auditLog({ action: "settings.updated", tenantId, userId: user.id });
  revalidatePath("/settings");
}




export async function startAppUpdateAction() {
  const user = await requireSuperAdmin();
  await assertPermission(user, "platform.updates.run");
  const result = await startAppUpdate();
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
    await saveSettings(formData);

    const tenantId = isSuperAdmin(user) ? user.activeTenantId ?? (await mainTenantId()) : user.tenantId;

    await sendMail({
      tenantId,
      to,
      subject: "FortiGate Backup mailtest",
      text: "Deze testmail bevestigt dat de mailconfiguratie correct werkt."
    });

    await auditLog({ action: "settings.mail_test.sent", tenantId, userId: user.id, metadata: { provider: formData.get("mail.provider"), to } });
    revalidatePath("/settings");
    return { ok: true, message: `Testmail verzonden naar ${to}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Testmail kon niet worden verzonden."
    };
  }
}
