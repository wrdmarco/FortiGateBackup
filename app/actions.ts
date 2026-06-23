"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auditLog } from "@/lib/audit";
import { assertTenantAccess, isSuperAdmin, requireSuperAdmin, requireTenantUser } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { runBackup } from "@/lib/fortigate";
import { createSession, destroySession } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import { customerSchema, fortigateSchema, fortigateUpdateSchema, tenantSchema } from "@/lib/validators";

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function bool(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function boolField(formData: FormData, name: string) {
  return formData.getAll(name).some((value) => value === "on" || value === "true");
}

function checkLoginThrottle(email: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    throw new Error("Te veel mislukte pogingen. Probeer het later opnieuw.");
  }
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
    await requireSuperAdmin();
  }
  const data = tenantSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
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
  await createSession(admin.id);
  revalidatePath("/");
  redirect("/");
}

export async function createManagedTenant(formData: FormData) {
  const user = await requireSuperAdmin();
  const data = tenantSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    active: true
  });
  const adminEmail = String(formData.get("adminEmail") ?? "").toLowerCase();
  const adminPassword = String(formData.get("adminPassword") ?? "");
  const adminName = String(formData.get("adminName") ?? "");
  if (!adminEmail || adminPassword.length < 12) {
    throw new Error("Admin e-mail en een wachtwoord van minimaal 12 tekens zijn verplicht.");
  }

  const tenant = await prisma.tenant.create({ data });
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: adminName || "Tenant Admin",
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
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
  revalidatePath("/tenants");
}

export async function setTenantActive(formData: FormData) {
  const user = await requireSuperAdmin();
  const id = String(formData.get("id"));
  const active = bool(formData.get("active"));
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

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").toLowerCase();
  const password = String(formData.get("password") ?? "");
  checkLoginThrottle(email);
  const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  if (!user?.passwordHash || !user.active) {
    recordLoginFailure(email);
    throw new Error("Ongeldige inloggegevens.");
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordLoginFailure(email);
    throw new Error("Ongeldige inloggegevens.");
  }
  if (!isSuperAdmin(user) && !user.tenant?.active) {
    throw new Error("Deze tenant is niet actief.");
  }
  loginAttempts.delete(email);
  await createSession(user.id);
  await auditLog({ action: "auth.login", tenantId: user.tenantId, userId: user.id, entity: "User", entityId: user.id });
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
    active: true
  });
  assertTenantAccess(user, data.tenantId);
  const customer = await prisma.customer.create({ data });
  await auditLog({
    action: "customer.created",
    tenantId: customer.tenantId,
    entity: "Customer",
    entityId: customer.id
  });
  revalidatePath("/customers");
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
    cronExpression: formData.get("cronExpression") || undefined
  });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: parsed.customerId } });
  assertTenantAccess(user, customer.tenantId);
  const device = await prisma.fortiGate.create({
    data: {
      customerId: parsed.customerId,
      managementUrl: parsed.managementUrl,
      httpsPort: parsed.httpsPort,
      apiTokenEncrypted: encryptSecret(parsed.apiToken),
      tlsVerify: parsed.tlsVerify,
      vdom: parsed.vdom,
      scheduleType: parsed.scheduleType,
      cronExpression: parsed.cronExpression
    },
    include: { customer: true }
  });
  await auditLog({
    action: "fortigate.created",
    tenantId: device.customer.tenantId,
    entity: "FortiGate",
    entityId: device.id
  });
  revalidatePath("/fortigates");
}

export async function updateFortiGate(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const existing = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  assertTenantAccess(user, existing.customer.tenantId);
  const parsed = fortigateUpdateSchema.parse({
    customerId: formData.get("customerId"),
    managementUrl: formData.get("managementUrl"),
    httpsPort: formData.get("httpsPort"),
    apiToken: formData.get("apiToken") || undefined,
    tlsVerify: boolField(formData, "tlsVerify"),
    vdom: formData.get("vdom") || undefined,
    scheduleType: formData.get("scheduleType") || "DAILY",
    cronExpression: formData.get("cronExpression") || undefined
  });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: parsed.customerId } });
  assertTenantAccess(user, customer.tenantId);

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
      cronExpression: parsed.cronExpression
    },
    include: { customer: true }
  });
  await auditLog({
    action: "fortigate.updated",
    tenantId: device.customer.tenantId,
    entity: "FortiGate",
    entityId: device.id,
    metadata: { tokenUpdated: Boolean(parsed.apiToken) }
  });
  revalidatePath("/fortigates");
  redirect("/fortigates");
}

export async function deleteFortiGate(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  assertTenantAccess(user, device.customer.tenantId);
  await auditLog({
    action: "fortigate.deleted",
    tenantId: device.customer.tenantId,
    entity: "FortiGate",
    entityId: device.id,
    metadata: {
      customerId: device.customerId,
      managementUrl: device.managementUrl,
      hostname: device.hostname,
      serialNumber: device.serialNumber
    }
  });
  await prisma.fortiGate.delete({ where: { id } });
  revalidatePath("/fortigates");
  revalidatePath("/backups");
}

export async function runBackupAction(formData: FormData) {
  const user = await requireTenantUser();
  const id = String(formData.get("id"));
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  assertTenantAccess(user, device.customer.tenantId);
  await runBackup(id);
  revalidatePath("/fortigates");
  revalidatePath("/backups");
}

export async function saveSettings(formData: FormData) {
  const user = await requireTenantUser();
  const requestedTenantId = String(formData.get("tenantId") || "") || null;
  const tenantId = isSuperAdmin(user) ? requestedTenantId : user.tenantId;
  const entries = [
    ["mail.provider", formData.get("mail.provider")],
    ["smtp.host", formData.get("smtp.host")],
    ["smtp.port", formData.get("smtp.port")],
    ["smtp.user", formData.get("smtp.user")],
    ["smtp.from", formData.get("smtp.from")],
    ["graph.from", formData.get("graph.from")],
    ["entra.tenantId", formData.get("entra.tenantId")],
    ["entra.clientId", formData.get("entra.clientId")]
  ] as const;
  for (const [key, value] of entries) {
    if (value) await setSetting(key, String(value), { tenantId });
  }
  const smtpPassword = formData.get("smtp.password");
  const graphToken = formData.get("graph.accessToken");
  const entraSecret = formData.get("entra.clientSecret");
  if (smtpPassword) await setSetting("smtp.password", String(smtpPassword), { tenantId, encrypted: true });
  if (graphToken) await setSetting("graph.accessToken", String(graphToken), { tenantId, encrypted: true });
  if (entraSecret) await setSetting("entra.clientSecret", String(entraSecret), { tenantId, encrypted: true });
  await auditLog({ action: "settings.updated", tenantId });
  revalidatePath("/settings");
}
