import { BackupStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { getSetting } from "@/lib/settings";

type BackupNotificationPayload = {
  event: "backup.success" | "backup.failed";
  tenantId: string;
  backupId: string;
  status: BackupStatus;
  customer: string;
  fortigate: {
    id: string;
    hostname: string | null;
    managementUrl: string;
    serialNumber: string | null;
  };
  filesize: number;
  sha256: string | null;
  error: string | null;
  createdAt: string;
};

export async function notifyBackupResult(backupId: string) {
  const backup = await prisma.backup.findUnique({
    where: { id: backupId },
    include: {
      fortigate: {
        include: {
          customer: true
        }
      }
    }
  });
  if (!backup) return;

  const tenantId = backup.fortigate.customer.tenantId;
  const success = backup.status !== BackupStatus.FAILED;
  const notifySuccess = (await getSetting("backup.notifySuccess", tenantId)) === "true";
  const notifyFailures = (await getSetting("backup.notifyFailures", tenantId)) !== "false";
  if ((success && !notifySuccess) || (!success && !notifyFailures)) return;

  const [notifyEmail, notifyWebhook, recipients, webhookUrl] = await Promise.all([
    getSetting("backup.notifyEmail", tenantId),
    getSetting("backup.notifyWebhook", tenantId),
    getSetting("backup.notifyRecipients", tenantId),
    getSetting("backup.webhookUrl", tenantId)
  ]);

  const payload: BackupNotificationPayload = {
    event: success ? "backup.success" : "backup.failed",
    tenantId,
    backupId: backup.id,
    status: backup.status,
    customer: backup.fortigate.customer.name,
    fortigate: {
      id: backup.fortigate.id,
      hostname: backup.fortigate.hostname,
      managementUrl: backup.fortigate.managementUrl,
      serialNumber: backup.fortigate.serialNumber
    },
    filesize: backup.filesize,
    sha256: backup.sha256,
    error: backup.error,
    createdAt: backup.createdAt.toISOString()
  };

  if (notifyEmail === "true" && recipients) {
    await notifyByMail(tenantId, recipients, payload);
  }
  if (notifyWebhook === "true" && webhookUrl) {
    await notifyByWebhook(tenantId, webhookUrl, payload);
  }
}

async function notifyByMail(tenantId: string, recipients: string, payload: BackupNotificationPayload) {
  try {
    await sendMail({
      tenantId,
      to: recipients,
      subject: `${payload.event === "backup.failed" ? "Backup mislukt" : "Backup succesvol"} - ${payload.fortigate.hostname ?? payload.fortigate.managementUrl}`,
      text: [
        `Status: ${payload.status}`,
        `Tenant klant: ${payload.customer}`,
        `FortiGate: ${payload.fortigate.hostname ?? payload.fortigate.managementUrl}`,
        `Serienummer: ${payload.fortigate.serialNumber ?? "Onbekend"}`,
        `Backup ID: ${payload.backupId}`,
        `Tijdstip: ${payload.createdAt}`,
        payload.sha256 ? `SHA256: ${payload.sha256}` : null,
        payload.error ? `Fout: ${payload.error}` : null
      ]
        .filter(Boolean)
        .join("\n")
    });
  } catch (error) {
    await auditNotificationFailure(tenantId, "mail", payload, error);
  }
}

async function notifyByWebhook(tenantId: string, webhookUrl: string, payload: BackupNotificationPayload) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Webhook gaf HTTP ${response.status}.${body ? ` Body: ${body.slice(0, 500)}` : ""}`);
    }
  } catch (error) {
    await auditNotificationFailure(tenantId, "webhook", payload, error);
  }
}

async function auditNotificationFailure(
  tenantId: string,
  channel: "mail" | "webhook",
  payload: BackupNotificationPayload,
  error: unknown
) {
  await auditLog({
    action: "backup.notification_failed",
    tenantId,
    entity: "Backup",
    entityId: payload.backupId,
    metadata: {
      channel,
      event: payload.event,
      error: error instanceof Error ? error.message : "Onbekende notificatiefout"
    }
  });
}
