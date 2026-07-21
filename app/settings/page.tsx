import { saveSettings, startAppUpdateAction, testMailSettings } from "@/app/actions";
import { SettingsForm } from "@/components/settings-form";
import { SettingsTabs } from "@/components/settings-tabs";
import { UpdateStartForm } from "@/components/update-start-form";
import { Badge, PageHeader, Panel, Shell } from "@/components/ui";
import { getAppUpdateStatus } from "@/lib/app-update";
import { prisma } from "@/lib/db";
import { getMailProviderMode } from "@/lib/mail";
import { hasPermission } from "@/lib/rbac";
import { getSetting } from "@/lib/settings";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { defaultTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

const settingKeys = [
  "smtp.password",
  "itglue.apiKey",
  "autotask.integrationCode",
  "autotask.secret",
  "graph.accessToken",
  "graph.clientSecret",
  "entra.clientSecret"
] as const;

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const user = await requireUser({ allowBreakGlassSettingsOnly: true });
  const canManagePlatform = Boolean(user.tenantId && (await isGlobalTenantId(user.tenantId)));
  const params = await searchParams;
  const globalTenantId = await mainTenantId();
  const selectedTenantId = canManagePlatform ? user.activeTenantId ?? globalTenantId ?? "" : user.tenantId ?? "";
  const tenantId = selectedTenantId || null;
  const isGlobalScope = Boolean(tenantId && tenantId === globalTenantId);
  const [canReadBaseSettings, canReadMail, canReadItGlue, canReadAutotask, canReadSso, canReadUpdates, canRunUpdates] =
    user.breakGlassSettingsOnly
      ? [false, false, false, false, true, false, false]
      : await Promise.all([
          hasPermission(user, isGlobalScope ? "platform.settings.read" : "tenant.settings.read"),
          hasPermission(user, "integrations.mail.read"),
          hasPermission(user, "integrations.itglue.read"),
          hasPermission(user, "integrations.autotask.read"),
          hasPermission(user, "integrations.sso.read"),
          isGlobalScope ? hasPermission(user, "platform.updates.read") : Promise.resolve(false),
          isGlobalScope ? hasPermission(user, "platform.updates.run") : Promise.resolve(false)
        ]);
  const [canUpdateBaseSettings, canUpdateMail, canUpdateItGlue, canUpdateAutotask, canUpdateSso, canTestMail] =
    user.breakGlassSettingsOnly
      ? [false, false, false, false, true, false]
      : await Promise.all([
          hasPermission(user, isGlobalScope ? "platform.settings.update" : "tenant.settings.update"),
          hasPermission(user, "integrations.mail.update"),
          hasPermission(user, "integrations.itglue.update"),
          hasPermission(user, "integrations.autotask.update"),
          hasPermission(user, "integrations.sso.update"),
          hasPermission(user, "integrations.mail.test")
        ]);
  const selectedTenantName =
    user.activeTenant?.name ??
    (user.tenantId === selectedTenantId ? user.tenant?.name : null) ??
    (selectedTenantId === globalTenantId ? "Global" : "Deze tenant");
  const secretScopeWhere = { tenantId: tenantId ?? null };

  const [
    portalSiteUrl,
    effectiveSiteUrl,
    timeZone,
    itGlueEnabled,
    itGlueBaseUrl,
    autotaskEnabled,
    autotaskBaseUrl,
    autotaskUsername,
    autotaskQueueId,
    autotaskPriorityId,
    autotaskWorkTypeId,
    autotaskStatusId,
    autotaskSourceId,
    autotaskIssueTypeId,
    autotaskSubIssueTypeId,
    mailProvider,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpFrom,
    graphFrom,
    graphTenantId,
    graphClientId,
    entraEnabled,
    entraTenantId,
    entraClientId,
    schedulerEnabled,
    schedulerMaxParallelJobs,
    backupScheduleEnabled,
    backupDefaultSchedule,
    backupRetentionCount,
    backupRetryCount,
    backupNotifyFailures,
    backupNotifySuccess,
    backupNotifyEmail,
    backupNotifyWebhook,
    backupNotifyAutotask,
    backupNotifyRecipients,
    backupWebhookUrl,
    savedSecrets,
    updateStatus
  ] = await Promise.all([
    getSetting("portal.siteUrl", tenantId),
    globalTenantId ? getSetting("portal.siteUrl", globalTenantId) : Promise.resolve(""),
    getSetting("ui.timeZone", tenantId),
    getSetting("itglue.enabled", tenantId),
    getSetting("itglue.baseUrl", tenantId),
    getSetting("autotask.enabled", tenantId),
    getSetting("autotask.baseUrl", tenantId),
    getSetting("autotask.username", tenantId),
    getSetting("autotask.queueId", tenantId),
    getSetting("autotask.priorityId", tenantId),
    getSetting("autotask.workTypeId", tenantId),
    getSetting("autotask.statusId", tenantId),
    getSetting("autotask.sourceId", tenantId),
    getSetting("autotask.issueTypeId", tenantId),
    getSetting("autotask.subIssueTypeId", tenantId),
    getMailProviderMode(tenantId),
    getSetting("smtp.host", tenantId),
    getSetting("smtp.port", tenantId),
    getSetting("smtp.user", tenantId),
    getSetting("smtp.from", tenantId),
    getSetting("graph.from", tenantId),
    getSetting("graph.tenantId", tenantId),
    getSetting("graph.clientId", tenantId),
    getSetting("entra.enabled", tenantId),
    getSetting("entra.tenantId", tenantId),
    getSetting("entra.clientId", tenantId),
    getSetting("scheduler.enabled", tenantId),
    getSetting("scheduler.maxParallelJobs", tenantId),
    getSetting("backup.schedule.enabled", tenantId),
    getSetting("backup.defaultSchedule", tenantId),
    getSetting("backup.retention.count", tenantId),
    getSetting("backup.retry.count", tenantId),
    getSetting("backup.notifyFailures", tenantId),
    getSetting("backup.notifySuccess", tenantId),
    getSetting("backup.notifyEmail", tenantId),
    getSetting("backup.notifyWebhook", tenantId),
    getSetting("backup.notifyAutotask", tenantId),
    getSetting("backup.notifyRecipients", tenantId),
    getSetting("backup.webhookUrl", tenantId),
    prisma.systemSetting.findMany({
      where: {
        ...secretScopeWhere,
        key: { in: [...settingKeys] }
      },
      select: { key: true }
    }),
    canReadUpdates ? getAppUpdateStatus() : Promise.resolve(null)
  ]);
  const secretKeys = new Set(savedSecrets.map((setting) => setting.key));
  const values = {
    portalSiteUrl: portalSiteUrl ?? "",
    effectiveSiteUrl: portalSiteUrl ?? effectiveSiteUrl ?? "",
    timeZone: timeZone ?? defaultTimeZone,
    itGlueEnabled: itGlueEnabled === "true",
    itGlueBaseUrl: itGlueBaseUrl ?? "https://api.itglue.com",
    hasItGlueApiKey: secretKeys.has("itglue.apiKey"),
    autotaskEnabled: autotaskEnabled === "true",
    autotaskBaseUrl: autotaskBaseUrl ?? "https://webservices.autotask.net/atservicesrest/v1.0",
    autotaskUsername: autotaskUsername ?? "",
    hasAutotaskIntegrationCode: secretKeys.has("autotask.integrationCode"),
    hasAutotaskSecret: secretKeys.has("autotask.secret"),
    autotaskQueueId: autotaskQueueId ?? "",
    autotaskPriorityId: autotaskPriorityId ?? "",
    autotaskWorkTypeId: autotaskWorkTypeId ?? "",
    autotaskStatusId: autotaskStatusId ?? "",
    autotaskSourceId: autotaskSourceId ?? "",
    autotaskIssueTypeId: autotaskIssueTypeId ?? "",
    autotaskSubIssueTypeId: autotaskSubIssueTypeId ?? "",
    mailProvider: mailProvider === "SYSTEM" ? ("SYSTEM" as const) : mailProvider === "MICROSOFT_GRAPH" ? ("MICROSOFT_GRAPH" as const) : ("SMTP" as const),
    smtpHost: smtpHost ?? "",
    smtpPort: smtpPort ?? "587",
    smtpUser: smtpUser ?? "",
    smtpFrom: smtpFrom ?? "",
    graphFrom: graphFrom ?? "",
    graphTenantId: graphTenantId ?? "",
    graphClientId: graphClientId ?? "",
    entraEnabled: entraEnabled === "true",
    entraTenantId: entraTenantId ?? "",
    entraClientId: entraClientId ?? "",
    hasSmtpPassword: secretKeys.has("smtp.password"),
    hasGraphClientSecret: secretKeys.has("graph.clientSecret") || secretKeys.has("graph.accessToken"),
    hasEntraSecret: secretKeys.has("entra.clientSecret"),
    testMailTo: user.email,
    schedulerEnabled: schedulerEnabled !== "false",
    schedulerMaxParallelJobs: schedulerMaxParallelJobs ?? "20",
    backupScheduleEnabled: backupScheduleEnabled !== "false",
    backupDefaultSchedule: backupDefaultSchedule ?? "DAILY",
    backupRetentionCount: backupRetentionCount ?? "30",
    backupRetryCount: backupRetryCount ?? "2",
    backupNotifyFailures: backupNotifyFailures !== "false",
    backupNotifySuccess: backupNotifySuccess === "true",
    backupNotifyEmail: backupNotifyEmail === "true",
    backupNotifyWebhook: backupNotifyWebhook === "true",
    backupNotifyAutotask: backupNotifyAutotask === "true",
    backupNotifyRecipients: backupNotifyRecipients ?? "",
    backupWebhookUrl: backupWebhookUrl ?? ""
  };
  const safeValues = {
    ...values,
    ...(!canReadBaseSettings
      ? {
          portalSiteUrl: "",
          effectiveSiteUrl: "",
          schedulerEnabled: false,
          schedulerMaxParallelJobs: "",
          backupScheduleEnabled: false,
          backupDefaultSchedule: "DAILY",
          backupRetentionCount: "",
          backupRetryCount: "",
          backupNotifyFailures: false,
          backupNotifySuccess: false,
          backupNotifyEmail: false,
          backupNotifyWebhook: false,
          backupNotifyAutotask: false,
          backupNotifyRecipients: "",
          backupWebhookUrl: ""
        }
      : {}),
    ...(!canReadItGlue ? { itGlueEnabled: false, itGlueBaseUrl: "", hasItGlueApiKey: false } : {}),
    ...(!canReadAutotask
      ? {
          autotaskEnabled: false,
          autotaskBaseUrl: "",
          autotaskUsername: "",
          hasAutotaskIntegrationCode: false,
          hasAutotaskSecret: false,
          autotaskQueueId: "",
          autotaskPriorityId: "",
          autotaskWorkTypeId: "",
          autotaskStatusId: "",
          autotaskSourceId: "",
          autotaskIssueTypeId: "",
          autotaskSubIssueTypeId: ""
        }
      : {}),
    ...(!canReadMail
      ? {
          mailProvider: "SMTP" as const,
          smtpHost: "",
          smtpPort: "",
          smtpUser: "",
          smtpFrom: "",
          graphFrom: "",
          graphTenantId: "",
          graphClientId: "",
          hasSmtpPassword: false,
          hasGraphClientSecret: false
        }
      : {}),
    ...(!canReadSso ? { entraEnabled: false, entraTenantId: "", entraClientId: "", hasEntraSecret: false } : {})
  };
  const formProps = {
    action: saveSettings,
    testMailAction: testMailSettings,
    tenants: [],
    selectedTenantId,
    selectedTenantName,
    values: safeValues,
    allowSystemMail: !isGlobalScope
  };
  const configTabs = user.breakGlassSettingsOnly
    ? ["sso"]
    : [
        ...(!isGlobalScope && canReadBaseSettings ? ["portal"] : []),
        ...(!isGlobalScope && canReadItGlue ? ["itglue"] : []),
        ...(!isGlobalScope && canReadAutotask ? ["autotask"] : []),
        ...(canReadMail ? ["mail"] : []),
        ...(canReadSso ? ["sso"] : []),
        ...(canReadBaseSettings ? ["scheduler"] : [])
      ];
  const tabIds = [...configTabs, ...(updateStatus ? ["updates"] : [])];
  if (!tabIds.length || (params?.tab && !tabIds.includes(params.tab))) notFound();
  const activeTab = params?.tab ?? tabIds[0];

  return (
    <Shell>
      <PageHeader
        title="Instellingen"
        description={isGlobalScope ? "Beheer platforminstellingen voor Global." : `Beheer tenantinstellingen voor ${selectedTenantName}.`}
      />
      <SettingsTabs
        activeTab={activeTab}
        tabs={[
          ...(!isGlobalScope && canReadBaseSettings ? [{
            id: "portal",
            label: "Portal",
            href: settingsHref("portal"),
            description: "Beheer de publieke URL per tenant voor links, notificaties en portalverwijzingen.",
            content: (
              <Panel>
                <SettingsForm key={`${selectedTenantId}:portal`} {...formProps} canUpdate={canUpdateBaseSettings} visibleTabs={["portal"]} initialTab="portal" />
              </Panel>
            )
          }] : []),
          ...(!isGlobalScope && canReadItGlue ? [{
            id: "itglue",
            label: "IT Glue",
            href: settingsHref("itglue"),
            description: "Koppel FortiGate backups aan IT Glue organizations en configurations.",
            content: (
              <Panel>
                <SettingsForm key={`${selectedTenantId}:itglue`} {...formProps} canUpdate={canUpdateItGlue} visibleTabs={["itglue"]} initialTab="itglue" />
              </Panel>
            )
          }] : []),
          ...(!isGlobalScope && canReadAutotask ? [{
            id: "autotask",
            label: "Autotask",
            href: settingsHref("autotask"),
            description: "Maak Autotask tickets voor backupreports onder de juiste klant.",
            content: (
              <Panel>
                <SettingsForm key={`${selectedTenantId}:autotask`} {...formProps} canUpdate={canUpdateAutotask} visibleTabs={["autotask"]} initialTab="autotask" />
              </Panel>
            )
          }] : []),
          ...(canReadMail ? [{
            id: "mail",
            label: "Mail",
            href: settingsHref("mail"),
            description: isGlobalScope ? "Beheer de globale maildefaults voor onboarding en notificaties." : "Beheer SMTP of Microsoft Graph mailconfiguratie voor deze tenant.",
            content: (
              <Panel>
                <SettingsForm
                  key={`${selectedTenantId}:mail`}
                  {...formProps}
                  canUpdate={canUpdateMail}
                  canTestMail={canTestMail}
                  visibleTabs={["mail"]}
                  initialTab="mail"
                />
              </Panel>
            )
          }] : []),
          ...(canReadBaseSettings ? [{
            id: "scheduler",
            label: isGlobalScope ? "Scheduler" : "Backupschema",
            href: settingsHref("scheduler"),
            description: isGlobalScope ? "Beheer scheduler-engine en globale veiligheidslimieten." : "Beheer automatische backupinstellingen voor deze tenant.",
            content: (
              <Panel>
                <SettingsForm key={`${selectedTenantId}:scheduler`} {...formProps} canUpdate={canUpdateBaseSettings} visibleTabs={["scheduler"]} initialTab="scheduler" />
              </Panel>
            )
          }] : []),
          ...(canReadSso ? [{
            id: "sso",
            label: "SSO",
            href: settingsHref("sso"),
            description: isGlobalScope ? "Beheer Microsoft Entra ID login voor platformbeheerders." : "Beheer Microsoft Entra ID login voor deze tenant.",
            content: (
              <Panel>
                <SettingsForm key={`${selectedTenantId}:sso`} {...formProps} canUpdate={canUpdateSso} visibleTabs={["sso"]} initialTab="sso" />
              </Panel>
            )
          }] : []),
          ...(updateStatus
            ? [
                {
                  id: "updates",
                  label: "Updates",
                  href: settingsHref("updates"),
                  description: "Controleer GitHub op een nieuwe versie en start de serverupdate direct vanaf het portaal.",
                  content: (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)]">
                    <Panel title="Update-status" description="Versie en broncontrole van deze installatie.">
                      <div className="grid gap-5">
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          <Info label="Huidige versie" value={updateStatus.currentVersion} />
                          <Info label="Branch" value={updateStatus.branch ?? "Onbekend"} />
                          <Info label="Lokale commit" value={shortSha(updateStatus.localCommit)} mono />
                          <Info label="GitHub commit" value={shortSha(updateStatus.remoteCommit)} mono />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={updateStatus.updateRunning ? "warning" : updateStatus.updateAvailable ? "danger" : "success"}>
                            {updateStatus.updateRunning ? "Update draait" : updateStatus.updateAvailable ? "Update beschikbaar" : "Actueel"}
                          </Badge>
                          {updateStatus.error ? <span className="text-sm text-red-600 dark:text-red-300">{updateStatus.error}</span> : null}
                        </div>
                        {canRunUpdates ? (
                          <UpdateStartForm
                            action={startAppUpdateAction}
                            disabled={updateStatus.updateRunning}
                            updateAvailable={updateStatus.updateAvailable}
                          />
                        ) : null}
                      </div>
                    </Panel>
                    <Panel title="Uitvoer" description="Laatste resultaat van de updatecontrole of installatie.">
                      {updateStatus.lastLog ? (
                        <pre className="min-h-64 max-h-[32rem] overflow-auto rounded-md border border-border bg-[hsl(var(--header))] p-4 font-mono text-xs leading-5 text-white/75">
                          {updateStatus.lastLog}
                        </pre>
                      ) : <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-border bg-surface-soft text-sm text-muted-foreground">Nog geen update-uitvoer beschikbaar.</div>}
                    </Panel>
                    </div>
                  )
                }
              ]
            : [])
        ]}
      />
    </Shell>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm font-semibold"}>{value}</p>
    </div>
  );
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 12) : "Onbekend";
}
function settingsHref(tab: string) {
  const params = new URLSearchParams({ tab });
  return `/settings?${params.toString()}`;
}
import { notFound } from "next/navigation";
