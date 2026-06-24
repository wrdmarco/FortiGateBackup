"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";

type TenantOption = {
  id: string;
  name: string;
};

type SettingsValues = {
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
};

const tabs = [
  { id: "mail", label: "Mail" },
  { id: "sso", label: "SSO" }
] as const;

export function SettingsForm({
  action,
  tenants,
  selectedTenantId,
  values
}: {
  action: (formData: FormData) => void | Promise<void>;
  tenants: TenantOption[];
  selectedTenantId: string;
  values: SettingsValues;
}) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("mail");
  const [mailProvider, setMailProvider] = useState(values.mailProvider);
  const [entraEnabled, setEntraEnabled] = useState(values.entraEnabled);
  const scopeLabel = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId)?.name ?? "Globaal",
    [selectedTenantId, tenants]
  );

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
                window.location.href = value ? `/settings?tenantId=${value}` : "/settings";
              }}
            >
              <option value="">Globaal</option>
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

      <div className="overflow-x-auto rounded-md border border-border bg-surface p-1">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Configuratie tabs">
          {tabs.map((tab) => (
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
          <div className="grid gap-4 md:grid-cols-2">
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
          <div className="grid gap-4 md:grid-cols-2">
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
      </section>

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