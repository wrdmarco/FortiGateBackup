"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FortiGateCreateState } from "@/app/actions";
import { FieldError, FormFeedback } from "@/components/form-feedback";

type CustomerOption = {
  id: string;
  name: string;
};

type WizardStep = {
  title: string;
  eyebrow: string;
  description: string;
};

type WizardFieldName =
  | "customerId"
  | "managementUrl"
  | "httpsPort"
  | "itGlueConfigurationId"
  | "apiToken"
  | "tlsVerify"
  | "scheduleType"
  | "cronExpression";

type ValidationResult = {
  errors: Partial<Record<WizardFieldName, string>>;
  firstInvalid?: WizardFieldName;
};

const fieldsByStep: Partial<Record<number, WizardFieldName[]>> = {
  0: ["customerId"],
  2: ["managementUrl", "httpsPort", "itGlueConfigurationId", "apiToken", "tlsVerify"],
  3: ["scheduleType", "cronExpression"]
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
  itGlueEnabled = false,
  successHref
}: {
  customers: CustomerOption[];
  action: (state: FortiGateCreateState, formData: FormData) => Promise<FortiGateCreateState>;
  defaultCustomerId?: string;
  defaultScheduleType?: string;
  itGlueEnabled?: boolean;
  successHref?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<WizardFieldName, string>>>({});
  const [scheduleType, setScheduleType] = useState(defaultScheduleType);
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const selectedCustomerId = customers.some((customer) => customer.id === defaultCustomerId)
    ? defaultCustomerId
    : customers[0]?.id;

  useEffect(() => {
    if (!state.ok) return;
    window.location.href = state.customerId && state.deviceId
      ? `/customers/${state.customerId}/fortigates/${state.deviceId}`
      : successHref ?? "/customers";
  }, [state.customerId, state.deviceId, state.ok, successHref]);

  function fieldElement(name: WizardFieldName) {
    if (name === "tlsVerify") {
      return formRef.current?.querySelector<HTMLInputElement>('input[name="tlsVerify"][type="checkbox"]') ?? null;
    }
    return formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  }

  function collectStepErrors(stepIndex: number): ValidationResult {
    const errors: Partial<Record<WizardFieldName, string>> = {};
    const addError = (name: WizardFieldName, message: string) => {
      if (!errors[name]) errors[name] = message;
    };

    if (stepIndex === 0) {
      const customer = fieldElement("customerId") as HTMLSelectElement | null;
      if (!customer?.value) addError("customerId", "Selecteer een klant voordat je verdergaat.");
    }

    if (stepIndex === 2) {
      const managementUrl = fieldElement("managementUrl") as HTMLInputElement | null;
      const managementUrlValue = managementUrl?.value.trim() ?? "";
      if (!managementUrlValue) {
        addError("managementUrl", "Vul de HTTPS-management-URL van de FortiGate in.");
      } else {
        try {
          const parsedUrl = new URL(managementUrlValue);
          if (parsedUrl.protocol !== "https:") {
            addError("managementUrl", "Gebruik een HTTPS-URL; onbeveiligde HTTP-verbindingen zijn niet toegestaan.");
          }
        } catch {
          addError("managementUrl", "Vul een volledige URL in, bijvoorbeeld https://firewall.klant.nl.");
        }
      }

      const httpsPort = fieldElement("httpsPort") as HTMLInputElement | null;
      const port = httpsPort?.valueAsNumber ?? Number.NaN;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        addError("httpsPort", "Vul een geldige HTTPS-poort tussen 1 en 65535 in.");
      }

      if (itGlueEnabled) {
        const itGlueId = (fieldElement("itGlueConfigurationId") as HTMLInputElement | null)?.value.trim();
        if (!itGlueId) addError("itGlueConfigurationId", "Vul de IT Glue configuration ID in.");
      }

      const apiToken = (fieldElement("apiToken") as HTMLInputElement | null)?.value.trim();
      if (!apiToken) addError("apiToken", "Vul de API-token van de REST API Admin in.");

      const tlsVerify = fieldElement("tlsVerify") as HTMLInputElement | null;
      if (!tlsVerify?.checked) {
        addError("tlsVerify", "TLS-certificaatvalidatie is verplicht voor nieuwe FortiGate-verbindingen.");
      }
    }

    if (stepIndex === 3) {
      const schedule = (fieldElement("scheduleType") as HTMLSelectElement | null)?.value;
      if (!schedule) addError("scheduleType", "Selecteer een backupschema.");
      if (schedule === "CRON") {
        const cron = (fieldElement("cronExpression") as HTMLInputElement | null)?.value.trim() ?? "";
        if (cron.split(/\s+/).filter(Boolean).length !== 5) {
          addError("cronExpression", "Gebruik een cronexpressie met vijf velden, bijvoorbeeld 0 3 * * *.");
        }
      }
    }

    return { errors, firstInvalid: Object.keys(errors)[0] as WizardFieldName | undefined };
  }

  function validateStep(stepIndex: number, focusInvalid = true) {
    const result = collectStepErrors(stepIndex);
    const stepFields = fieldsByStep[stepIndex] ?? [];
    setFieldErrors((current) => {
      const next = { ...current };
      stepFields.forEach((name) => delete next[name]);
      return { ...next, ...result.errors };
    });

    if (result.firstInvalid && focusInvalid) {
      const element = fieldElement(result.firstInvalid);
      element?.focus();
      element?.reportValidity();
    }
    return result;
  }

  function clearFieldError(name: WizardFieldName) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function validateField(name: WizardFieldName) {
    const stepEntry = Object.entries(fieldsByStep).find(([, names]) => names?.includes(name));
    if (!stepEntry) return;
    const result = collectStepErrors(Number(stepEntry[0]));
    setFieldErrors((current) => {
      const next = { ...current };
      if (result.errors[name]) next[name] = result.errors[name];
      else delete next[name];
      return next;
    });
  }

  function goToNextStep() {
    if (validateStep(step).firstInvalid) return;
    const nextStep = Math.min(steps.length - 1, step + 1);
    setFurthestStep((current) => Math.max(current, nextStep));
    setStep(nextStep);
  }

  function selectStep(nextStep: number) {
    if (nextStep > furthestStep || pending) return;
    if (nextStep > step && validateStep(step).firstInvalid) return;
    setStep(nextStep);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    for (const stepIndex of [0, 2, 3]) {
      const result = validateStep(stepIndex, false);
      if (!result.firstInvalid) continue;
      event.preventDefault();
      setStep(stepIndex);
      window.requestAnimationFrame(() => fieldElement(result.firstInvalid!)?.focus());
      return;
    }
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-6" onSubmit={handleSubmit} aria-busy={pending}>
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <nav className="grid gap-2 self-start rounded-md border border-border bg-surface-soft p-2">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => selectStep(index)}
              disabled={pending || index > furthestStep}
              aria-current={step === index ? "step" : undefined}
              aria-label={`${item.eyebrow}: ${item.title}${index > furthestStep ? ", nog niet beschikbaar" : ""}`}
              className={`min-h-11 rounded-md px-3 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45 ${
                step === index
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="block text-xs opacity-75">{index < furthestStep ? "Voltooid" : item.eyebrow}</span>
              <span className="font-semibold">{item.title}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-[500px] rounded-md border border-border bg-surface p-5">
          <div className="mb-5 border-b border-border pb-4" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {steps[step].eyebrow} van {steps.length}
            </p>
            <h3 id="wizard-step-title" className="mt-1 text-xl font-semibold tracking-tight">{steps[step].title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{steps[step].description}</p>
          </div>

          <section hidden={step !== 0} className="grid gap-5" aria-labelledby="wizard-step-title">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Klant</span>
              <select
                id="wizard-customer"
                className="min-h-11 rounded-md border border-border bg-surface px-3 py-2"
                name="customerId"
                defaultValue={selectedCustomerId}
                required={step === 0}
                aria-invalid={Boolean(fieldErrors.customerId)}
                aria-describedby={`wizard-customer-help${fieldErrors.customerId ? " wizard-customer-error" : ""}`}
                onChange={() => clearFieldError("customerId")}
                onBlur={() => validateField("customerId")}
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <span id="wizard-customer-help" className="text-xs text-muted-foreground">
                Open je deze wizard vanuit een klantkaart, dan staat de klant automatisch goed.
              </span>
              <FieldError id="wizard-customer-error" message={fieldErrors.customerId} />
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

          <section hidden={step !== 1} className="grid gap-5" aria-labelledby="wizard-step-title">
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

          <section hidden={step !== 2} className="grid gap-4" aria-labelledby="wizard-step-title">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Management URL</span>
              <input
                id="wizard-management-url"
                className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                name="managementUrl"
                type="url"
                placeholder="https://10.0.0.1"
                required={step === 2}
                inputMode="url"
                aria-invalid={Boolean(fieldErrors.managementUrl)}
                aria-describedby={`wizard-management-url-help${fieldErrors.managementUrl ? " wizard-management-url-error" : ""}`}
                onInput={() => clearFieldError("managementUrl")}
                onBlur={() => validateField("managementUrl")}
              />
              <span id="wizard-management-url-help" className="text-xs text-muted-foreground">
                Gebruik een HTTPS-FQDN of management-VIP die vanaf de backupserver bereikbaar is en naar een vertrouwd certificaat leidt.
              </span>
              <FieldError id="wizard-management-url-error" message={fieldErrors.managementUrl} />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">HTTPS poort</span>
                <input
                  id="wizard-https-port"
                  className="min-h-11 rounded-md border border-border bg-surface px-3 py-2"
                  name="httpsPort"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={443}
                  required={step === 2}
                  aria-invalid={Boolean(fieldErrors.httpsPort)}
                  aria-describedby={`wizard-https-port-help${fieldErrors.httpsPort ? " wizard-https-port-error" : ""}`}
                  onInput={() => clearFieldError("httpsPort")}
                  onBlur={() => validateField("httpsPort")}
                />
                <span id="wizard-https-port-help" className="text-xs text-muted-foreground">Meestal 443, tenzij de admin GUI op een afwijkende poort draait.</span>
                <FieldError id="wizard-https-port-error" message={fieldErrors.httpsPort} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">VDOM</span>
                <input className="min-h-11 rounded-md border border-border bg-surface px-3 py-2" name="vdom" placeholder="Leeg laten voor global" />
                <span className="text-xs text-muted-foreground">Gebruik de exacte VDOM-naam, bijvoorbeeld root. Laat leeg als VDOMs niet gebruikt worden.</span>
              </label>
            </div>

            {itGlueEnabled ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">IT Glue configuration ID</span>
                <input
                  id="wizard-itglue-id"
                  className="min-h-11 rounded-md border border-border bg-surface px-3 py-2"
                  name="itGlueConfigurationId"
                  placeholder="Bijvoorbeeld 123456789"
                  required={step === 2}
                  aria-invalid={Boolean(fieldErrors.itGlueConfigurationId)}
                  aria-describedby={`wizard-itglue-help${fieldErrors.itGlueConfigurationId ? " wizard-itglue-error" : ""}`}
                  onInput={() => clearFieldError("itGlueConfigurationId")}
                  onBlur={() => validateField("itGlueConfigurationId")}
                />
                <span id="wizard-itglue-help" className="text-xs text-muted-foreground">
                  Verplicht omdat IT Glue actief is voor deze tenant. Dit is de configuration waar gewijzigde configs als bijlage onder komen.
                </span>
                <FieldError id="wizard-itglue-error" message={fieldErrors.itGlueConfigurationId} />
              </label>
            ) : null}

            <label className="grid gap-1 text-sm">
              <span className="font-medium">API-token</span>
              <input
                id="wizard-api-token"
                className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                name="apiToken"
                type="password"
                autoComplete="new-password"
                required={step === 2}
                aria-invalid={Boolean(fieldErrors.apiToken)}
                aria-describedby={`wizard-api-token-help${fieldErrors.apiToken ? " wizard-api-token-error" : ""}`}
                onInput={() => clearFieldError("apiToken")}
                onBlur={() => validateField("apiToken")}
              />
              <span id="wizard-api-token-help" className="text-xs text-muted-foreground">De token wordt versleuteld opgeslagen en later niet meer leesbaar getoond.</span>
              <FieldError id="wizard-api-token-error" message={fieldErrors.apiToken} />
            </label>

            <label className="flex min-h-11 items-start gap-3 rounded-md border border-border bg-surface-soft p-4 text-sm">
              <input name="tlsVerify" type="hidden" value="false" />
              <input
                className="mt-1 h-5 w-5 shrink-0"
                name="tlsVerify"
                type="checkbox"
                value="true"
                defaultChecked
                required={step === 2}
                aria-invalid={Boolean(fieldErrors.tlsVerify)}
                aria-describedby={fieldErrors.tlsVerify ? "wizard-tls-help wizard-tls-error" : "wizard-tls-help"}
                onChange={() => clearFieldError("tlsVerify")}
                onBlur={() => validateField("tlsVerify")}
              />
              <span>
                <span className="block font-medium">TLS certificaat valideren</span>
                <span id="wizard-tls-help" className="text-muted-foreground">
                  Verplicht. Gebruik een certificaatketen die de backupserver vertrouwt; voeg bij een intern CA-certificaat de CA toe aan de truststore.
                </span>
                <FieldError id="wizard-tls-error" message={fieldErrors.tlsVerify} />
              </span>
            </label>
          </section>

          <section hidden={step !== 3} className="grid gap-5" aria-labelledby="wizard-step-title">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Backupschema</span>
              <select
                id="wizard-schedule"
                className="min-h-11 rounded-md border border-border bg-surface px-3 py-2"
                name="scheduleType"
                value={scheduleType}
                required={step === 3}
                aria-invalid={Boolean(fieldErrors.scheduleType)}
                aria-describedby={`wizard-schedule-help${fieldErrors.scheduleType ? " wizard-schedule-error" : ""}`}
                onChange={(event) => {
                  setScheduleType(event.target.value);
                  clearFieldError("scheduleType");
                  clearFieldError("cronExpression");
                }}
                onBlur={() => validateField("scheduleType")}
              >
                <option value="HOURLY">Elk uur</option>
                <option value="DAILY">Dagelijks</option>
                <option value="WEEKLY">Wekelijks</option>
                <option value="MONTHLY">Maandelijks</option>
                <option value="CRON">Cron</option>
              </select>
              <span id="wizard-schedule-help" className="text-xs text-muted-foreground">Dagelijks is voor de meeste klanten een nette balans tussen historie en opslag.</span>
              <FieldError id="wizard-schedule-error" message={fieldErrors.scheduleType} />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium">Cron expressie</span>
              <input
                id="wizard-cron-expression"
                className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 disabled:cursor-not-allowed disabled:opacity-55"
                name="cronExpression"
                placeholder="Bijvoorbeeld 0 3 * * *"
                disabled={scheduleType !== "CRON"}
                required={step === 3 && scheduleType === "CRON"}
                pattern="(?:\\S+\\s+){4}\\S+"
                aria-invalid={Boolean(fieldErrors.cronExpression)}
                aria-describedby={`wizard-cron-help${fieldErrors.cronExpression ? " wizard-cron-error" : ""}`}
                onInput={() => clearFieldError("cronExpression")}
                onBlur={() => validateField("cronExpression")}
              />
              <span id="wizard-cron-help" className="text-xs text-muted-foreground">
                Alleen beschikbaar bij het schema Cron; gebruik vijf velden in de tijdzone van de tenant.
              </span>
              <FieldError id="wizard-cron-error" message={fieldErrors.cronExpression} />
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

          <section hidden={step !== 4} className="grid gap-5" aria-labelledby="wizard-step-title">
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
            <WizardButton type="button" onClick={goToNextStep}>
              Volgende
            </WizardButton>
          ) : (
            <WizardButton disabled={pending}>{pending ? "Opslaan..." : "FortiGate opslaan"}</WizardButton>
          )}
        </div>
      </div>
      <FormFeedback state={state} pending={pending} pendingMessage="FortiGate opslaan..." />
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
