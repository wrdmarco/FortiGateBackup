"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { MailTestState } from "@/app/actions";
import { commonTimeZones, defaultTimeZone } from "@/lib/time";

type TenantOption = {
  id: string;
  name: string;
};

type SettingsValues = {
  portalSiteUrl: string;
  effectiveSiteUrl: string;
  timeZone: string;
  itGlueEnabled: boolean;
  itGlueBaseUrl: string;
  hasItGlueApiKey: boolean;
  mailProvider: "SMTP" | "MICROSOFT_GRAPH";
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  graphFrom: string;
  graphTenantId: string;
  graphClientId: string;
  entraEnabled: boolean;
  entraTenantId: string;
  entraClientId: string;
  hasSmtpPassword: boolean;
  hasGraphClientSecret: boolean;
  hasEntraSecret: boolean;
  testMailTo: string;
};

type SettingsTabId = "portal" | "itglue" | "mail" | "sso";

const tabs: { id: SettingsTabId; label: string }[] = [
  { id: "portal", label: "Portal" },
  { id: "itglue", label: "IT Glue" },
  { id: "mail", label: "Mail" },
  { id: "sso", label: "SSO" }
];

export function SettingsForm({
  action,
  testMailAction,
  tenants,
  selectedTenantId,
  values,
  visibleTabs,
  initialTab = "portal"
}: {
  action: (formData: FormData) => void | Promise<void>;
  testMailAction: (state: MailTestState, formData: FormData) => Promise<MailTestState>;
  tenants: TenantOption[];
  selectedTenantId: string;
  values: SettingsValues;
  visibleTabs?: SettingsTabId[];
  initialTab?: SettingsTabId;
}) {
  const availableTabs = visibleTabs?.length ? tabs.filter((tab) => visibleTabs.includes(tab.id)) : tabs;
  const firstTab = availableTabs.some((tab) => tab.id === initialTab) ? initialTab : availableTabs[0]?.id ?? "portal";
  const [activeTab, setActiveTab] = useState<SettingsTabId>(firstTab);
  const [mailProvider, setMailProvider] = useState(values.mailProvider);
  const [entraEnabled, setEntraEnabled] = useState(values.entraEnabled);
  const [mailTestState, runMailTest, mailTestPending] = useActionState(testMailAction, { ok: false, message: "" });
  const scopeLabel = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId)?.name ?? "Global",
    [selectedTenantId, tenants]
  );
  const showTab = (id: SettingsTabId) => availableTabs.some((tab) => tab.id === id);

  useEffect(() => {
    setMailProvider(values.mailProvider);
  }, [values.mailProvider]);

  useEffect(() => {
    setEntraEnabled(values.entraEnabled);
  }, [values.entraEnabled]);

  return (
    <form action={action} className="grid gap-6">
      <section className="grid gap-3 rounded-md border border-border bg-surface-soft p-4">
        <div>
          <h2 className="font-semibold">Configuratiescope</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Je bewerkt nu instellingen voor <strong>{scopeLabel}</strong>.
          </p>
        </div>
        {tenants.length ? (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Tenant</span>
            <select
              className="rounded-md border border-border bg-surface px-3 py-2"
              name="tenantId"
              value={selectedTenantId}
              onChange={(event) => {
                const value = event.target.value;
                const params = new URLSearchParams({ tab: activeTab });
                if (value) params.set("tenantId", value);
                window.location.href = `/settings?${params.toString()}`;
              }}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="tenantId" value={selectedTenantId} />
        )}
        {tenants.length ? <input type="hidden" name="tenantId" value={selectedTenantId} /> : null}
      </section>

      {availableTabs.length > 1 ? (
        <div className="overflow-x-auto rounded-md border border-border bg-surface p-1">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Configuratie tabs">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={clsx(
                  "rounded px-4 py-2 text-sm font-medium transition",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showTab("portal") ? (
        <section hidden={activeTab !== "portal"} className="grid gap-4 rounded-md border border-border bg-surface-soft p-4">
          <div>
            <h2 className="font-semibold">Tenant site URL</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stel de publieke URL in die deze tenant gebruikt voor links, notificaties en portalverwijzingen.
            </p>
          </div>
          <TextField
            label="Site URL"
            name="portal.siteUrl"
            type="text"
            defaultValue={values.portalSiteUrl}
            help={values.effectiveSiteUrl ? `Actieve URL: ${values.effectiveSiteUrl}` : "Laat leeg om de globale SERVER_URL of globale portal URL te gebruiken."}
          />
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Tijdzone</span>
            <select className="rounded-md border border-border bg-surface px-3 py-2" name="ui.timeZone" defaultValue={values.timeZone || defaultTimeZone}>
              {commonTimeZones.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">Deze tijdzone wordt gebruikt voor datums, logs, backups en planning binnen deze tenant.</span>
          </label>
        </section>
      ) : null}

      {showTab("itglue") ? (
        <section hidden={activeTab !== "itglue"} className="grid gap-4 rounded-md border border-border bg-surface-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">IT Glue integratie</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload gewijzigde FortiGate configbestanden als bijlage op de juiste IT Glue configuration.
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <input name="itglue.enabled" type="hidden" value="false" />
              <input name="itglue.enabled" type="checkbox" value="true" defaultChecked={values.itGlueEnabled} />
              IT Glue actief
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="API base URL" name="itglue.baseUrl" defaultValue={values.itGlueBaseUrl || "https://api.itglue.com"} />
            <TextField
              label={values.hasItGlueApiKey ? "Nieuwe API key" : "API key"}
              name="itglue.apiKey"
              type="password"
              help={values.hasItGlueApiKey ? "Er is al een IT Glue API key opgeslagen. Laat leeg om deze te behouden." : "De API key wordt versleuteld opgeslagen."}
            />
          </div>
          <div className="rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
            Vul bij klanten het IT Glue organization ID in en bij FortiGates het IT Glue configuration ID. Bij elke gewijzigde backup wordt het configbestand daar als bijlage verwerkt.
          </div>
        </section>
      ) : null}

      {showTab("mail") ? (
        <section hidden={activeTab !== "mail"} className="grid gap-4 rounded-md border border-border bg-surface-soft p-4">
          <div>
            <h2 className="font-semibold">Mailprovider</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kies de actieve mailmethode. Alleen de velden voor deze provider worden getoond en opgeslagen.
            </p>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Provider</span>
            <select
              className="rounded-md border border-border bg-surface px-3 py-2"
              name="mail.provider"
              value={mailProvider}
              onChange={(event) => setMailProvider(event.target.value as SettingsValues["mailProvider"])}
            >
              <option value="SMTP">SMTP</option>
              <option value="MICROSOFT_GRAPH">Microsoft Graph</option>
            </select>
          </label>

          {mailProvider === "SMTP" ? (
            <div key="smtp-settings" className="grid gap-4 md:grid-cols-2">
              <TextField label="SMTP host" name="smtp.host" defaultValue={values.smtpHost} required />
              <TextField label="SMTP poort" name="smtp.port" type="number" defaultValue={values.smtpPort || "587"} required />
              <TextField label="SMTP gebruiker" name="smtp.user" defaultValue={values.smtpUser} />
              <TextField
                label={values.hasSmtpPassword ? "Nieuw SMTP wachtwoord" : "SMTP wachtwoord"}
                name="smtp.password"
                type="password"
                help={values.hasSmtpPassword ? "Er is al een wachtwoord opgeslagen. Laat leeg om dit te behouden." : undefined}
              />
              <TextField label="SMTP afzender" name="smtp.from" type="email" defaultValue={values.smtpFrom} required />
            </div>
          ) : (
            <div key="graph-settings" className="grid gap-4 md:grid-cols-2">
              <TextField label="Graph afzender" name="graph.from" type="email" defaultValue={values.graphFrom} required />
              <TextField label="Tenant ID" name="graph.tenantId" defaultValue={values.graphTenantId} required />
              <TextField label="App / client ID" name="graph.clientId" defaultValue={values.graphClientId} required />
              <TextField
                label={values.hasGraphClientSecret ? "Nieuw client secret" : "Client secret"}
                name="graph.clientSecret"
                type="password"
                help={values.hasGraphClientSecret ? "Er is al een Graph client secret opgeslagen. Laat leeg om dit te behouden." : "Gebruik de secret value uit Microsoft Entra, niet de secret ID."}
              />
            </div>
          )}

          <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <TextField label="Testmail naar" name="mail.testTo" type="email" defaultValue={values.testMailTo} />
              <button
                className="rounded-md border border-border bg-surface-soft px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                formAction={runMailTest}
                disabled={mailTestPending}
              >
                {mailTestPending ? "Testmail versturen..." : "Testmail versturen"}
              </button>
            </div>
            {mailTestState.message ? (
              <p className={clsx("text-sm", mailTestState.ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300")}>
                {mailTestState.message}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {showTab("sso") ? (
        <section hidden={activeTab !== "sso"} className="grid gap-4 rounded-md border border-border bg-surface-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Microsoft Entra ID SSO</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Zet SSO alleen aan wanneer deze tenant via Microsoft Entra mag inloggen.
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <input name="entra.enabled" type="hidden" value="false" />
              <input
                name="entra.enabled"
                type="checkbox"
                value="true"
                checked={entraEnabled}
                onChange={(event) => setEntraEnabled(event.target.checked)}
              />
              SSO actief
            </label>
          </div>

          {entraEnabled ? (
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Tenant ID" name="entra.tenantId" defaultValue={values.entraTenantId} required />
              <TextField label="Client ID" name="entra.clientId" defaultValue={values.entraClientId} required />
              <TextField
                label={values.hasEntraSecret ? "Nieuw client secret" : "Client secret"}
                name="entra.clientSecret"
                type="password"
                help={values.hasEntraSecret ? "Er is al een client secret opgeslagen. Laat leeg om dit te behouden." : undefined}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <div>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
          Instellingen opslaan
        </button>
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  type = "text",
  defaultValue = "",
  help,
  required = false
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  help?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
      />
      {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
    </label>
  );
}
