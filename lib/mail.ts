import nodemailer from "nodemailer";
import { fetchWithTimeout, readResponseJson, readResponseText } from "@/lib/network-safety";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";

type MailInput = {
  tenantId?: string | null;
  to: string;
  subject: string;
  text: string;
};

function mailRecipients(to: string) {
  return to
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function sendMail(input: MailInput) {
  const provider = await getMailProvider(input.tenantId);
  if (provider === "MICROSOFT_GRAPH") {
    return sendGraphMail(input);
  }
  return sendSmtpMail(input);
}

export async function assertMailReady(tenantId?: string | null) {
  const provider = await getMailProvider(tenantId);
  if (provider === "MICROSOFT_GRAPH") {
    const [from, tenant, clientId, clientSecret, accessToken] = await Promise.all([
      getMailSetting("graph.from", tenantId),
      getMailSetting("graph.tenantId", tenantId),
      getMailSetting("graph.clientId", tenantId),
      getMailSetting("graph.clientSecret", tenantId),
      getMailSetting("graph.accessToken", tenantId)
    ]);
    if (!from || (!accessToken && (!tenant || !clientId || !clientSecret))) {
      throw new Error("Microsoft Graph mail is niet volledig ingesteld. Configureer en test eerst de mailinstellingen.");
    }
    return;
  }

  const [host, from, user, pass] = await Promise.all([
    getMailSetting("smtp.host", tenantId),
    getMailSetting("smtp.from", tenantId),
    getMailSetting("smtp.user", tenantId),
    getMailSetting("smtp.password", tenantId)
  ]);
  if (!host || !from || Boolean(user) !== Boolean(pass)) {
    throw new Error("SMTP mail is niet volledig ingesteld. Configureer en test eerst de mailinstellingen.");
  }
}

export async function getMailProvider(tenantId?: string | null) {
  const effectiveTenantId = await effectiveMailTenantId(tenantId);
  const provider = effectiveTenantId
    ? await getSetting("mail.provider", effectiveTenantId)
    : await getSetting("mail.provider", null);
  return provider === "MICROSOFT_GRAPH" ? "MICROSOFT_GRAPH" : "SMTP";
}

export async function getMailProviderMode(tenantId?: string | null) {
  if (!tenantId) return getMailProvider(tenantId);
  const globalTenantId = await mainTenantId();
  const provider = await getSetting("mail.provider", tenantId);
  if (tenantId !== globalTenantId && provider === "SYSTEM") return "SYSTEM";
  return provider === "MICROSOFT_GRAPH" ? "MICROSOFT_GRAPH" : "SMTP";
}

export async function getEffectiveMailSetting(key: string, tenantId?: string | null) {
  return getMailSetting(key, tenantId);
}

async function sendSmtpMail(input: MailInput) {
  const host = await getMailSetting("smtp.host", input.tenantId);
  const port = Number((await getMailSetting("smtp.port", input.tenantId)) ?? 587);
  const user = await getMailSetting("smtp.user", input.tenantId);
  const pass = await getMailSetting("smtp.password", input.tenantId);
  const from = await getMailSetting("smtp.from", input.tenantId);
  if (!host || !from) throw new Error("SMTP settings are incomplete.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP poort moet tussen 1 en 65535 liggen.");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error("SMTP hostnaam is ongeldig.");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return transporter.sendMail({ from, to: input.to, subject: input.subject, text: input.text });
}

async function sendGraphMail(input: MailInput) {
  const token = await getGraphAccessToken(input.tenantId);
  const from = await getMailSetting("graph.from", input.tenantId);
  if (!token || !from) throw new Error("Microsoft Graph mail settings are incomplete.");

  const response = await fetchWithTimeout(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: "Text", content: input.text },
          toRecipients: mailRecipients(input.to).map((address) => ({ emailAddress: { address } }))
        }
      })
    },
    20_000
  );
  if (!response.ok) {
    const body = await readResponseText(response, 32 * 1024).catch(() => "");
    throw new Error(`Microsoft Graph gaf HTTP ${response.status}.${body ? ` Body: ${body.slice(0, 500)}` : ""}`);
  }
}

async function getGraphAccessToken(tenantId?: string | null) {
  const tenant = await getMailSetting("graph.tenantId", tenantId);
  const clientId = await getMailSetting("graph.clientId", tenantId);
  const clientSecret = await getMailSetting("graph.clientSecret", tenantId);

  if (tenant && clientId && clientSecret) {
    const response = await fetchWithTimeout(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default"
        })
      },
      20_000
    );
    if (!response.ok) throw new Error(`Microsoft Graph token request returned ${response.status}.`);
    const payload = await readResponseJson<{ access_token?: string }>(response, 64 * 1024);
    if (!payload.access_token) throw new Error("Microsoft Graph token response bevat geen access token.");
    return payload.access_token;
  }

  return getMailSetting("graph.accessToken", tenantId);
}

async function getMailSetting(key: string, tenantId?: string | null) {
  const effectiveTenantId = await effectiveMailTenantId(tenantId);
  if (effectiveTenantId) return getSetting(key, effectiveTenantId);
  return getSetting(key, null);
}

async function effectiveMailTenantId(tenantId?: string | null) {
  if (!tenantId) return null;
  const globalTenantId = await mainTenantId();
  if (tenantId === globalTenantId) return tenantId;
  return (await getSetting("mail.provider", tenantId)) === "SYSTEM" ? globalTenantId : tenantId;
}
