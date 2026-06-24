import { saveSettings, startAppUpdateAction } from "@/app/actions";
import { SettingsForm } from "@/components/settings-form";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge, Button, PageHeader, Panel, Shell } from "@/components/ui";
import { getAppUpdateStatus } from "@/lib/app-update";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const settingKeys = ["smtp.password", "itglue.apiKey", "graph.accessToken", "graph.clientSecret", "entra.clientSecret"] as const;

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ tenantId?: string }>;
}) {
  const user = await requireUser();
  const canUpdateApp = isSuperAdmin(user);
  const params = await searchParams;
  const tenants = canUpdateApp
    ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" } })
    : [];
  const requestedTenantId = canUpdateApp ? params?.tenantId ?? "" : user.tenantId ?? "";
  const selectedTenantId = tenants.some((tenant) => tenant.id === requestedTenantId) ? requestedTenantId : "";
  const tenantId = selectedTenantId || null;

  const [
    portalSiteUrl,
    effectiveSiteUrl,
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
    savedSecrets,
    updateStatus
  ] = await Promise.all([
    getSetting("portal.siteUrl", tenantId),
    tenantId ? getSetting("portal.siteUrl", null) : Promise.resolve(process.env.SERVER_URL ?? ""),
    getSetting("itglue.enabled", tenantId),
    getSetting("itglue.baseUrl", tenantId),
    getSetting("mail.provider", tenantId),
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
    prisma.systemSetting.findMany({
      where: {
        tenantId,
        key: { in: [...settingKeys] }
      },
      select: { key: true }
    }),
    canUpdateApp ? getAppUpdateStatus() : Promise.resolve(null)
  ]);
  const secretKeys = new Set(savedSecrets.map((setting) => setting.key));

  return (
    <Shell>
      <PageHeader
        title="Instellingen"
        description="Beheer alleen de actieve mailprovider, SSO-velden en applicatie-updates die voor deze scope nodig zijn."
      />
      <SettingsTabs
        tabs={[
          {
            id: "configuratie",
            label: "Configuratie",
            description: "Beheer mail en SSO per scope zonder door een lange instellingenpagina te scrollen.",
            content: (
              <Panel className="max-w-4xl">
                <SettingsForm
                  action={saveSettings}
                  tenants={tenants}
                  selectedTenantId={selectedTenantId}
                  values={{
                    portalSiteUrl: portalSiteUrl ?? "",
                    effectiveSiteUrl: portalSiteUrl ?? effectiveSiteUrl ?? "",
                    itGlueEnabled: itGlueEnabled === "true",
                    itGlueBaseUrl: itGlueBaseUrl ?? "https://api.itglue.com",
                    hasItGlueApiKey: secretKeys.has("itglue.apiKey"),
                    mailProvider: mailProvider === "MICROSOFT_GRAPH" ? "MICROSOFT_GRAPH" : "SMTP",
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
                    hasEntraSecret: secretKeys.has("entra.clientSecret")
                  }}
                />
              </Panel>
            )
          },
          ...(updateStatus
            ? [
                {
                  id: "updates",
                  label: "Updates",
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