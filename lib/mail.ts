import nodemailer from "nodemailer";
import { getSetting } from "@/lib/settings";

type MailInput = {
  tenantId?: string | null;
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(input: MailInput) {
  const provider = await getSetting("mail.provider", input.tenantId);
  if (provider === "MICROSOFT_GRAPH") {
    return sendGraphMail(input);
  }
  return sendSmtpMail(input);
}

async function sendSmtpMail(input: MailInput) {
  const host = await getSetting("smtp.host", input.tenantId);
  const port = Number((await getSetting("smtp.port", input.tenantId)) ?? 587);
  const user = await getSetting("smtp.user", input.tenantId);
  const pass = await getSetting("smtp.password", input.tenantId);
  const from = await getSetting("smtp.from", input.tenantId);
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
  const token = await getSetting("graph.accessToken", input.tenantId);
  const from = await getSetting("graph.from", input.tenantId);
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
