import { saveSettings } from "@/app/actions";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader, Panel, Shell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const settingKeys = ["smtp.password", "graph.accessToken", "entra.clientSecret"] as const;

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ tenantId?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const tenants = isSuperAdmin(user)
    ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" } })
    : [];
  const requestedTenantId = isSuperAdmin(user) ? params?.tenantId ?? "" : user.tenantId ?? "";
  const selectedTenantId = tenants.some((tenant) => tenant.id === requestedTenantId) ? requestedTenantId : "";
  const tenantId = selectedTenantId || null;

  const [
    mailProvider,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpFrom,
    graphFrom,
    entraEnabled,
    entraTenantId,
    entraClientId,
    savedSecrets
  ] = await Promise.all([
    getSetting("mail.provider", tenantId),
    getSetting("smtp.host", tenantId),
    getSetting("smtp.port", tenantId),
    getSetting("smtp.user", tenantId),
    getSetting("smtp.from", tenantId),
    getSetting("graph.from", tenantId),
    getSetting("entra.enabled", tenantId),
    getSetting("entra.tenantId", tenantId),
    getSetting("entra.clientId", tenantId),
    prisma.systemSetting.findMany({
      where: {
        tenantId,
        key: { in: [...settingKeys] }
      },
      select: { key: true }
    })
  ]);
  const secretKeys = new Set(savedSecrets.map((setting) => setting.key));

  return (
    <Shell>
      <PageHeader
        title="Instellingen"
        description="Beheer alleen de actieve mailprovider en SSO-velden die voor deze scope nodig zijn."
      />
      <Panel className="max-w-4xl">
        <SettingsForm
          action={saveSettings}
          tenants={tenants}
          selectedTenantId={selectedTenantId}
          values={{
            mailProvider: mailProvider === "MICROSOFT_GRAPH" ? "MICROSOFT_GRAPH" : "SMTP",
            smtpHost: smtpHost ?? "",
            smtpPort: smtpPort ?? "587",
            smtpUser: smtpUser ?? "",
            smtpFrom: smtpFrom ?? "",
            graphFrom: graphFrom ?? "",
            entraEnabled: entraEnabled === "true",
            entraTenantId: entraTenantId ?? "",
            entraClientId: entraClientId ?? "",
            hasSmtpPassword: secretKeys.has("smtp.password"),
            hasGraphToken: secretKeys.has("graph.accessToken"),
            hasEntraSecret: secretKeys.has("entra.clientSecret")
          }}
        />
      </Panel>
    </Shell>
  );
}
