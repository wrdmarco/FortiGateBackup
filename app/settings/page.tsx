import { saveSettings, startAppUpdateAction, testMailSettings } from "@/app/actions";
import { SettingsForm } from "@/components/settings-form";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge, Button, PageHeader, Panel, Shell } from "@/components/ui";
import { getAppUpdateStatus } from "@/lib/app-update";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getEffectiveMailSetting, getMailProvider } from "@/lib/mail";
import { getSetting } from "@/lib/settings";
import { requireUser } from "@/lib/session";
import { mainTenantId } from "@/lib/tenant-main";
import { defaultTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

const settingKeys = ["smtp.password", "itglue.apiKey", "graph.accessToken", "graph.clientSecret", "entra.clientSecret"] as const;

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const canUpdateApp = isSuperAdmin(user);
  const params = await searchParams;
  const globalTenantId = canUpdateApp ? await mainTenantId() : null;
  const selectedTenantId = canUpdateApp ? user.activeTenantId ?? globalTenantId ?? "" : user.tenantId ?? "";
  const tenantId = selectedTenantId || null;
  const isGlobalScope = Boolean(tenantId && tenantId === globalTenantId);
  const selectedTenantName =
    user.activeTenant?.name ??
    (user.tenantId === selectedTenantId ? user.tenant?.name : null) ??
    (selectedTenantId === globalTenantId ? "Global" : "Deze tenant");
  const secretScopeWhere = tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null };

  const [
    portalSiteUrl,
    effectiveSiteUrl,
    timeZone,
    itGlueEnabled,
    itGlueBaseUrl,
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
    savedSecrets,
    updateStatus
  ] = await Promise.all([
    getSetting("portal.siteUrl", tenantId),
    tenantId ? getSetting("portal.siteUrl", null) : Promise.resolve(process.env.SERVER_URL ?? ""),
    getSetting("ui.timeZone", tenantId),
    getSetting("itglue.enabled", tenantId),
    getSetting("itglue.baseUrl", tenantId),
    getMailProvider(tenantId),
    getEffectiveMailSetting("smtp.host", tenantId),
    getEffectiveMailSetting("smtp.port", tenantId),
    getEffectiveMailSetting("smtp.user", tenantId),
    getEffectiveMailSetting("smtp.from", tenantId),
    getEffectiveMailSetting("graph.from", tenantId),
    getEffectiveMailSetting("graph.tenantId", tenantId),
    getEffectiveMailSetting("graph.clientId", tenantId),
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
    prisma.systemSetting.findMany({
      where: {
        ...secretScopeWhere,
        key: { in: [...settingKeys] }
      },
      select: { key: true }
    }),
    canUpdateApp ? getAppUpdateStatus() : Promise.resolve(null)
  ]);
  const secretKeys = new Set(savedSecrets.map((setting) => setting.key));
  const values = {
    portalSiteUrl: portalSiteUrl ?? "",
    effectiveSiteUrl: portalSiteUrl ?? effectiveSiteUrl ?? "",
    timeZone: timeZone ?? defaultTimeZone,
    itGlueEnabled: itGlueEnabled === "true",
    itGlueBaseUrl: itGlueBaseUrl ?? "https://api.itglue.com",
    hasItGlueApiKey: secretKeys.has("itglue.apiKey"),
    mailProvider: mailProvider === "MICROSOFT_GRAPH" ? ("MICROSOFT_GRAPH" as const) : ("SMTP" as const),
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
    backupNotifyFailures: backupNotifyFailures !== "false"
  };
  const formProps = { action: saveSettings, testMailAction: testMailSettings, tenants: [], selectedTenantId, selectedTenantName, values };
  const configTabs = isGlobalScope ? ["mail", "sso", "scheduler"] : ["portal", "itglue", "mail", "sso", "scheduler"];
  const tabIds = [...configTabs, ...(updateStatus ? ["updates"] : [])];
  const activeTab = params?.tab && tabIds.includes(params.tab) ? params.tab : configTabs[0];

  return (
    <Shell>
      <PageHeader
        title="Instellingen"
        description={isGlobalScope ? "Beheer platforminstellingen voor Global." : `Beheer tenantinstellingen voor ${selectedTenantName}.`}
      />
      <SettingsTabs
        activeTab={activeTab}
        tabs={[
          ...(!isGlobalScope ? [{
            id: "portal",
            label: "Portal",
            href: settingsHref("portal"),
            description: "Beheer de publieke URL per tenant voor links, notificaties en portalverwijzingen.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm {...formProps} visibleTabs={["portal"]} initialTab="portal" />
              </Panel>
            )
          }] : []),
          ...(!isGlobalScope ? [{
            id: "itglue",
            label: "IT Glue",
            href: settingsHref("itglue"),
            description: "Koppel FortiGate backups aan IT Glue organizations en configurations.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm {...formProps} visibleTabs={["itglue"]} initialTab="itglue" />
              </Panel>
            )
          }] : []),
          {
            id: "mail",
            label: "Mail",
            href: settingsHref("mail"),
            description: isGlobalScope ? "Beheer de globale maildefaults voor onboarding en notificaties." : "Beheer SMTP of Microsoft Graph mailconfiguratie voor deze tenant.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm {...formProps} visibleTabs={["mail"]} initialTab="mail" />
              </Panel>
            )
          },
          {
            id: "scheduler",
            label: isGlobalScope ? "Scheduler" : "Backupschema",
            href: settingsHref("scheduler"),
            description: isGlobalScope ? "Beheer scheduler-engine en globale veiligheidslimieten." : "Beheer automatische backupinstellingen voor deze tenant.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm {...formProps} visibleTabs={["scheduler"]} initialTab="scheduler" />
              </Panel>
            )
          },
          {
            id: "sso",
            label: "SSO",
            href: settingsHref("sso"),
            description: isGlobalScope ? "Beheer Microsoft Entra ID login voor platformbeheerders." : "Beheer Microsoft Entra ID login voor deze tenant.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm {...formProps} visibleTabs={["sso"]} initialTab="sso" />
              </Panel>
            )
          },
          ...(updateStatus
            ? [
                {
                  id: "updates",
                  label: "Updates",
                  href: settingsHref("updates"),
                  description: "Controleer GitHub op een nieuwe versie en start de serverupdate direct vanaf het portaal.",
                  content: (
                    <Panel title="Applicatie update" className="max-w-4xl">
                      <div className="grid gap-4">
                        <div className="grid gap-3 text-sm md:grid-cols-2">
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
                        {updateStatus.lastLog ? (
                          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
                            {updateStatus.lastLog}
                          </pre>
                        ) : null}
                        <form action={startAppUpdateAction}>
                          <Button disabled={updateStatus.updateRunning} variant={updateStatus.updateAvailable ? "primary" : "secondary"}>
                            {updateStatus.updateAvailable ? "Check en update nu" : "Opnieuw checken / update starten"}
                          </Button>
                        </form>
                      </div>
                    </Panel>
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
