"use client";

import { useActionState, useEffect, useState } from "react";
import type { FortiGateCreateState } from "@/app/actions";

type CustomerOption = {
  id: string;
  name: string;
};

type WizardStep = {
  title: string;
  eyebrow: string;
  description: string;
};

const steps: WizardStep[] = [
  {
    title: "Intake",
    eyebrow: "Stap 1",
    description: "Bepaal klant, bereikbaarheid en beheerafspraken voordat je iets op de FortiGate wijzigt."
  },
  {
    title: "API admin",
    eyebrow: "Stap 2",
    description: "Maak de juiste REST API Admin aan en beperk de toegang na de eerste succesvolle test."
  },
  {
    title: "Verbinding",
    eyebrow: "Stap 3",
    description: "Leg URL, poort, VDOM en API-token vast zoals de backupserver de firewall ziet."
  },
  {
    title: "Backup",
    eyebrow: "Stap 4",
    description: "Kies het schema en voorkom ruis door alleen gewijzigde configuraties op te slaan."
  },
  {
    title: "Controle",
    eyebrow: "Stap 5",
    description: "Controleer de inrichting en voer daarna direct een eerste handmatige backup uit."
  }
];

export function FortiGateWizard({
  customers,
  action,
  defaultCustomerId,
  defaultScheduleType = "DAILY",
  itGlueEnabled = false
}: {
  customers: CustomerOption[];
  action: (state: FortiGateCreateState, formData: FormData) => Promise<FortiGateCreateState>;
  defaultCustomerId?: string;
  defaultScheduleType?: string;
  itGlueEnabled?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const selectedCustomerId = customers.some((customer) => customer.id === defaultCustomerId)
    ? defaultCustomerId
    : customers[0]?.id;

  useEffect(() => {
    if (state.ok) window.location.href = "/fortigates";
  }, [state.ok]);

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <nav className="grid gap-2 self-start rounded-md border border-border bg-surface-soft p-2">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setStep(index)}
              className={`rounded-md px-3 py-3 text-left text-sm transition ${
                step === index
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="block text-xs opacity-75">{item.eyebrow}</span>
              <span className="font-semibold">{item.title}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-[500px] rounded-md border border-border bg-surface p-5">
          <div className="mb-5 border-b border-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{steps[step].eyebrow}</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">{steps[step].title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{steps[step].description}</p>
          </div>

          <section className={step === 0 ? "grid gap-5" : "hidden"}>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Klant</span>
              <select
                className="rounded-md border border-border bg-surface px-3 py-2"
                name="customerId"
                defaultValue={selectedCustomerId}
                required
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                Open je deze wizard vanuit een klantkaart, dan staat de klant automatisch goed.
              </span>
            </label>

            <div className="grid gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
              <p className="font-semibold">Voor je begint</p>
              <CheckItem text="Je kunt vanaf deze server de managementinterface van de FortiGate bereiken." />
              <CheckItem text="Je weet of de firewall VDOMs gebruikt en welke VDOM geback-upt moet worden." />
              <CheckItem text="Je hebt rechten om een REST API Admin aan te maken of een bestaande token te regenereren." />
              <CheckItem text="Je hebt bepaald of TLS-verificatie aan kan blijven met een vertrouwd certificaat." />
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <p className="font-semibold">Praktische werkwijze</p>
              <p className="mt-2">
                Werk eerst met een testbackup. Als die slaagt, beperk je Trusted Hosts en eventueel het adminprofiel.
                Zo weet je zeker dat je geen rechtenprobleem verwart met een netwerk- of certificaatprobleem.
              </p>
            </div>
          </section>

          <section className={step === 1 ? "grid gap-5" : "hidden"}>
            <div className="grid gap-4">
              <Instruction number="1" title="Open de FortiGate GUI">
                Log in op de FortiGate en ga naar System, Administrators, Create New, REST API Admin.
              </Instruction>
              <Instruction number="2" title="Maak een dedicated API admin">
                Gebruik een herkenbare naam zoals api-backup. Vul eventueel een comment in met de naam van deze backupserver.
              </Instruction>
              <Instruction number="3" title="Kies tijdelijk ruime rechten">
                Gebruik voor de eerste test super_admin. Zodra de backup werkt, kun je dit versmallen naar een profiel met configuratie-exportrechten.
              </Instruction>
              <Instruction number="4" title="Genereer de API key">
                Klik op Regenerate bij API key en kopieer de token direct. De username hoeft niet in het portaal; de token is gekoppeld aan deze API admin.
              </Instruction>
            </div>

            <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">Hardening na succesvolle test</p>
              <p>Zet Trusted Hosts aan en sta alleen het IP-adres van de backupserver toe.</p>
              <p>Laat CORS Allow Origin uit. Deze applicatie belt server-side naar de FortiGate.</p>
              <p>Gebruik PKI alleen als jullie FortiGate-beheerproces dat expliciet vereist.</p>
            </div>
          </section>

          <section className={step === 2 ? "grid gap-4" : "hidden"}>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Management URL</span>
              <input
                className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                name="managementUrl"
                type="url"
                placeholder="https://10.0.0.1"
                required
              />
              <span className="text-xs text-muted-foreground">
                Gebruik het adres dat vanaf de backupserver bereikbaar is. Dit mag een intern IP, FQDN of management-VIP zijn.
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">HTTPS poort</span>
                <input className="rounded-md border border-border bg-surface px-3 py-2" name="httpsPort" type="number" defaultValue={443} required />
                <span className="text-xs text-muted-foreground">Meestal 443, tenzij de admin GUI op een afwijkende poort draait.</span>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">VDOM</span>
                <input className="rounded-md border border-border bg-surface px-3 py-2" name="vdom" placeholder="Leeg laten voor global" />
                <span className="text-xs text-muted-foreground">Gebruik de exacte VDOM-naam, bijvoorbeeld root. Laat leeg als VDOMs niet gebruikt worden.</span>
              </label>
            </div>

            {itGlueEnabled ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">IT Glue configuration ID</span>
                <input className="rounded-md border border-border bg-surface px-3 py-2" name="itGlueConfigurationId" placeholder="Bijvoorbeeld 123456789" />
                <span className="text-xs text-muted-foreground">
                  Verplicht omdat IT Glue actief is voor deze tenant. Dit is de configuration waar gewijzigde configs als bijlage onder komen.
                </span>
              </label>
            ) : null}

            <label className="grid gap-1 text-sm">
              <span className="font-medium">API-token</span>
              <input
                className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                name="apiToken"
                type="password"
                autoComplete="off"
                required
              />
              <span className="text-xs text-muted-foreground">De token wordt versleuteld opgeslagen en later niet meer leesbaar getoond.</span>
            </label>

            <label className="flex items-start gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
              <input name="tlsVerify" type="hidden" value="false" />
              <input className="mt-1" name="tlsVerify" type="checkbox" value="true" />
              <span>
                <span className="block font-medium">TLS certificaat valideren</span>
                <span className="text-muted-foreground">
                  Laat standaard uit bij self-signed FortiGate-certificaten. Zet aan als de FortiGate een vertrouwd certificaat gebruikt.
                </span>
              </span>
            </label>
          </section>

          <section className={step === 3 ? "grid gap-5" : "hidden"}>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Backupschema</span>
              <select className="rounded-md border border-border bg-surface px-3 py-2" name="scheduleType" defaultValue={defaultScheduleType}>
                <option value="HOURLY">Elk uur</option>
                <option value="DAILY">Dagelijks</option>
                <option value="WEEKLY">Wekelijks</option>
                <option value="MONTHLY">Maandelijks</option>
                <option value="CRON">Cron</option>
              </select>
              <span className="text-xs text-muted-foreground">Dagelijks is voor de meeste klanten een nette balans tussen historie en opslag.</span>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium">Cron expressie</span>
              <input className="rounded-md border border-border bg-surface px-3 py-2" name="cronExpression" placeholder="Alleen nodig bij Cron, bijvoorbeeld 0 3 * * *" />
            </label>

            <div className="grid gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
              <p className="font-semibold">Wat gebeurt er bij een backup?</p>
              <CheckItem text="De applicatie vraagt de FortiGate-configuratie op via de REST API." />
              <CheckItem text="Firmware, model en hostname worden waar mogelijk uitgelezen en bijgewerkt." />
              <CheckItem text="Alleen echte configuratiewijzigingen tellen als changed; dynamische ruis wordt genegeerd." />
              <CheckItem text="Bij fouten zie je per FortiGate een logregel met endpoint, statuscode en diagnose." />
              {itGlueEnabled ? (
                <CheckItem text="Omdat IT Glue actief is, wordt alleen een gewijzigde backup als bijlage aan de gekoppelde configuration toegevoegd." />
              ) : null}
            </div>
          </section>

          <section className={step === 4 ? "grid gap-5" : "hidden"}>
            <div className="grid gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
              <p className="font-semibold">Laatste controle voor opslaan</p>
              <CheckItem text="De klant is correct geselecteerd." />
              <CheckItem text="De Management URL is bereikbaar vanaf de backupserver, niet alleen vanaf je laptop." />
              <CheckItem text="De API-token hoort bij een REST API Admin en is niet verlopen of opnieuw gegenereerd na kopieren." />
              <CheckItem text="Trusted Hosts staat na de eerste test beperkt op het IP-adres van de backupserver." />
              <CheckItem text="Bij een self-signed certificaat staat TLS verificatie uit, of het CA-certificaat is vertrouwd." />
            </div>

            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-950 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
              <p className="font-semibold">Na opslaan</p>
              <p className="mt-2">
                Start direct een handmatige backup vanuit de FortiGate-lijst of vanuit de klantkaart. Controleer daarna de laatste log,
                de firmwarestatus en download de eerste configuratie als bewijs dat de koppeling werkt.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <WizardButton type="button" variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Vorige
        </WizardButton>
        <div className="flex flex-wrap gap-2">
          {step < steps.length - 1 ? (
            <WizardButton type="button" onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>
              Volgende
            </WizardButton>
          ) : (
            <WizardButton disabled={pending}>{pending ? "Opslaan..." : "FortiGate opslaan"}</WizardButton>
          )}
        </div>
      </div>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-300"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Instruction({
  number,
  title,
  children
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function CheckItem({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
      <span className="text-muted-foreground">{text}</span>
    </div>
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
