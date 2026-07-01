import nodemailer from "nodemailer";
import { getSetting } from "@/lib/settings";

type MailInput = {
  tenantId?: string | null;
  to: string;
  subject: string;
  text: string;
};

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
  return (await getMailSetting("mail.provider", tenantId)) === "MICROSOFT_GRAPH" ? "MICROSOFT_GRAPH" : "SMTP";
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

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined
  });
  return transporter.sendMail({ from, to: input.to, subject: input.subject, text: input.text });
}

async function sendGraphMail(input: MailInput) {
  const token = await getGraphAccessToken(input.tenantId);
  const from = await getMailSetting("graph.from", input.tenantId);
  if (!token || !from) throw new Error("Microsoft Graph mail settings are incomplete.");

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${from}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "Text", content: input.text },
        toRecipients: [{ emailAddress: { address: input.to } }]
      }
    })
  });
  if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}.`);
}

async function getGraphAccessToken(tenantId?: string | null) {
  const tenant = await getMailSetting("graph.tenantId", tenantId);
  const clientId = await getMailSetting("graph.clientId", tenantId);
  const clientSecret = await getMailSetting("graph.clientSecret", tenantId);

  if (tenant && clientId && clientSecret) {
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default"
      })
    });
    if (!response.ok) throw new Error(`Microsoft Graph token request returned ${response.status}.`);
    const payload = (await response.json()) as { access_token?: string };
    return payload.access_token ?? null;
  }

  return getMailSetting("graph.accessToken", tenantId);
}

async function getMailSetting(key: string, tenantId?: string | null) {
  const tenantValue = tenantId ? await getSetting(key, tenantId) : null;
  return tenantValue ?? getSetting(key, null);
}
