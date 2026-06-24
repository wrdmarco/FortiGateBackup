"use client";

import { useState } from "react";

type CustomerOption = {
  id: string;
  name: string;
};

export function FortiGateWizard({
  customers,
  action
}: {
  customers: CustomerOption[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const steps = ["Voorbereiden", "Verbinden", "Planning"];

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-2 sm:grid-cols-3">
        {steps.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => setStep(index)}
            className={`rounded-md border px-3 py-2 text-left text-sm transition ${
              step === index
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:bg-muted"
            }`}
          >
            <span className="block text-xs opacity-75">Stap {index + 1}</span>
            <span className="font-semibold">{item}</span>
          </button>
        ))}
      </div>

      <section className={step === 0 ? "grid gap-5" : "hidden"}>
        <div className="rounded-md border border-border bg-surface-soft p-4">
          <h3 className="font-semibold">Wat je nodig hebt op de FortiGate</h3>
          <div className="mt-3 grid gap-3 text-sm text-muted-foreground">
            <p>
              Maak op de FortiGate een REST API Admin aan via <strong>System</strong>, <strong>Administrators</strong>,
              <strong> Create New</strong>, <strong>REST API Admin</strong>.
            </p>
            <p>
              Gebruik voor de eerste test het profiel <strong>super_admin</strong>. Werkt de backup, dan kun je later
              versmallen naar een profiel met alleen configuratie-exportrechten.
            </p>
            <p>
              Klik op <strong>Regenerate</strong> bij API key en plak die token in de volgende stap. De username hoeft
              niet in dit portaal; de token is al gekoppeld aan de FortiGate API admin.
            </p>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">Aanbevolen hardening na de test</p>
          <p>Zet Trusted Hosts aan en sta alleen het IP-adres van deze backupserver toe.</p>
          <p>Laat CORS Allow Origin uit. Die is niet nodig voor server-side API-calls.</p>
        </div>
      </section>

      <section className={step === 1 ? "grid gap-4" : "hidden"}>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Klant</span>
          <select className="rounded-md border border-border bg-surface px-3 py-2" name="customerId" required>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Management URL</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="managementUrl"
            type="url"
            placeholder="https://10.0.0.1"
            required
          />
          <span className="text-xs text-muted-foreground">Gebruik het adres waarop de backupserver de FortiGate kan bereiken.</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">HTTPS poort</span>
            <input className="rounded-md border border-border bg-surface px-3 py-2" name="httpsPort" type="number" defaultValue={443} required />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">VDOM</span>
            <input className="rounded-md border border-border bg-surface px-3 py-2" name="vdom" placeholder="Leeg laten voor global backup" />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">API-token</span>
          <input
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            name="apiToken"
            type="password"
            required
          />
          <span className="text-xs text-muted-foreground">Plak de API key uit de REST API Admin. Deze wordt versleuteld opgeslagen.</span>
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-soft p-3 text-sm">
          <input name="tlsVerify" type="hidden" value="false" />
          <input name="tlsVerify" type="checkbox" value="true" />
          TLS certificaat valideren
        </label>
      </section>

      <section className={step === 2 ? "grid gap-4" : "hidden"}>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Backupschema</span>
          <select className="rounded-md border border-border bg-surface px-3 py-2" name="scheduleType" defaultValue="DAILY">
            <option value="HOURLY">Elk uur</option>
            <option value="DAILY">Dagelijks</option>
            <option value="WEEKLY">Wekelijks</option>
            <option value="MONTHLY">Maandelijks</option>
            <option value="CRON">Cron</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Cron expressie</span>
          <input className="rounded-md border border-border bg-surface px-3 py-2" name="cronExpression" placeholder="Alleen nodig bij Cron" />
        </label>
        <div className="rounded-md border border-border bg-surface-soft p-4 text-sm text-muted-foreground">
          Na opslaan kun je direct vanuit de FortiGate-rij of klantkaart op <strong>Backup</strong> klikken. Logs tonen
          precies welke API-stap slaagt of faalt.
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <WizardButton type="button" variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Vorige
        </WizardButton>
        {step < steps.length - 1 ? (
          <WizardButton type="button" onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>
            Volgende
          </WizardButton>
        ) : (
          <WizardButton>FortiGate opslaan</WizardButton>
        )}
      </div>
    </form>
  );
}

function WizardButton({
  children,
  variant = "primary",
  ...props
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const className =
    variant === "secondary"
      ? "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
      : "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <button className={className} {...props}>
      {children}
    </button>
  );
}
