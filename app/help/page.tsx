import { Badge, PageHeader, Panel, Shell } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

type ManualStep = {
  title: string;
  body: string;
  result?: string;
};

export default async function HelpPage() {
  const user = await requireUser();
  const activeTenantId = user.activeTenantId ?? user.tenantId ?? null;
  const globalContext = await isGlobalTenantId(activeTenantId);

  return (
    <Shell>
      <PageHeader
        title="Gebruikershandleiding"
        description={
          globalContext
            ? "Volledige handleiding voor Global beheer, tenants, gebruikers, backups, integraties, updates en noodherstel."
            : "Handleiding voor tenantgebruik: klanten, FortiGates, backups, instellingen, rollen en audit binnen deze tenant."
        }
        actions={<Badge tone={globalContext ? "warning" : "success"}>{globalContext ? "Global manual" : "Tenant manual"}</Badge>}
      />

      <div className="grid gap-6">
        <ManualIntro globalContext={globalContext} />

        {globalContext ? (
          <>
            <GlobalTenantSwitchManual />
            <GlobalTenantManagementManual />
          </>
        ) : null}

        <TenantDailyManual />
        <BackupManual />
        <TenantSettingsManual globalContext={globalContext} />
        <RolesManual globalContext={globalContext} />
        <AuditManual globalContext={globalContext} />

        {globalContext ? (
          <>
            <TenantArchiveManual />
            <UpdateManual />
            <BreakGlassManual />
          </>
        ) : null}
      </div>
    </Shell>
  );
}

function ManualIntro({ globalContext }: { globalContext: boolean }) {
  return (
    <Panel title="Zo gebruik je deze handleiding" description="Volg de stappen in volgorde. Elk hoofdstuk toont wat je ziet, wat je invult en wat het resultaat hoort te zijn.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <p>
            De portal werkt contextgericht. In Global beheer je het platform. In een tenant beheer je klanten,
            FortiGates, backups, gebruikers en tenantinstellingen.
          </p>
          <p>
            De screenshots hieronder zijn schermvoorbeelden van de portal. Gebruik ze als herkenningspunt voor knoppen,
            menu-items en velden.
          </p>
        </div>
        <Screenshot title="Bovenbalk">
          <ScreenshotBar items={["Tenant switcher", "Gebruiker", "Profiel", "Help", "Licht/Donker", "Uitloggen"]} />
          <Callout x="right-5" y="top-16" label="Open het gebruikersmenu rechtsboven voor help, profiel en thema." />
        </Screenshot>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <QuickTile title="Global" body="Alle documentatie zichtbaar: platform, tenants, updates en herstel." active={globalContext} />
        <QuickTile title="Tenant" body="Alleen tenantinhoudelijke documentatie zichtbaar." active={!globalContext} />
        <QuickTile title="Veilig werken" body="Acties zijn tenant-gescheiden en worden gelogd in audit." />
      </div>
    </Panel>
  );
}

function GlobalTenantSwitchManual() {
  return (
    <ManualSection
      number="01"
      title="Van Global naar een tenant wisselen"
      description="Gebruik dit als Global beheerder wanneer je klantdata of tenantinstellingen moet controleren."
      steps={[
        {
          title: "Open de tenant switcher",
          body: "Klik bovenin op de actieve tenantnaam. In Global staat hier meestal Global.",
          result: "Je ziet een lijst met actieve tenants."
        },
        {
          title: "Kies de tenant",
          body: "Selecteer de tenant waarin je wilt werken.",
          result: "De portal stuurt je naar het dashboard van die tenant."
        },
        {
          title: "Controleer de context",
          body: "Bekijk rechtsboven of de juiste tenant actief is voordat je klanten of FortiGates opent.",
          result: "Alle acties en auditregels horen nu bij die tenant."
        }
      ]}
      screenshot={
        <Screenshot title="Tenant switcher">
          <ScreenshotBar items={["FortiGate Backup", "Global", "Gebruiker"]} />
          <div className="mt-4 w-64 rounded-md border border-border bg-surface p-2 shadow-sm">
            <div className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Global</div>
            <div className="mt-1 rounded px-3 py-2 text-sm">Klant A</div>
            <div className="rounded px-3 py-2 text-sm">Klant B</div>
          </div>
          <Callout x="left-44" y="top-20" label="Kies hier de tenantcontext." />
        </Screenshot>
      }
    />
  );
}

function GlobalTenantManagementManual() {
  return (
    <ManualSection
      number="02"
      title="Nieuwe tenant aanmaken"
      description="Maak een tenant inclusief eerste beheerder. Dit kan alleen vanuit Global."
      steps={[
        {
          title: "Ga naar Tenants",
          body: "Open Global en klik in de navigatie op Tenants.",
          result: "Je ziet het tenantoverzicht met bestaande tenants."
        },
        {
          title: "Klik op Tenant toevoegen",
          body: "Vul de tenantnaam, adminnaam, admin e-mail en eventueel het custom domein in.",
          result: "De portal genereert een tijdelijk wachtwoord voor de tenantadmin."
        },
        {
          title: "Controleer mailinstellingen",
          body: "Een tenant kan alleen worden aangemaakt als mail werkt. De uitnodiging wordt direct verstuurd.",
          result: "De admin ontvangt een loginlink en moet het tijdelijke wachtwoord wijzigen."
        }
      ]}
      screenshot={
        <Screenshot title="Tenant aanmaken">
          <ScreenshotTable headers={["Tenant", "Status", "Gebruikers", "Acties"]} rows={[["Klant A", "Actief", "2", "Beheren"], ["Klant B", "Actief", "1", "Backup zip"]]} />
          <Callout x="right-8" y="top-8" label="Gebruik Tenant toevoegen voor nieuwe klantenomgevingen." />
        </Screenshot>
      }
    />
  );
}

function TenantDailyManual() {
  return (
    <ManualSection
      number="03"
      title="Dagelijkse workflow: klant naar firewall naar backup"
      description="Werk altijd in deze volgorde. Daardoor is de klant al bekend wanneer je een FortiGate toevoegt."
      steps={[
        {
          title: "Open Klanten",
          body: "Ga in de tenant naar Klanten. Klik op Klant toevoegen als de klant nog niet bestaat.",
          result: "De klantkaart is het startpunt voor alle firewalls."
        },
        {
          title: "Open de klant",
          body: "Klik op Beheren bij de klant.",
          result: "Je ziet alle FortiGates van deze klant."
        },
        {
          title: "Voeg de FortiGate toe",
          body: "Klik op FortiGate toevoegen. Vul management URL, poort, API-token, TLS verify en planning in.",
          result: "De firewall staat onder de juiste klant."
        },
        {
          title: "Open de FortiGate",
          body: "Klik op Open. Alle firewallacties staan op de FortiGate-pagina.",
          result: "Je kunt nu backup draaien, logs bekijken en de laatste backup downloaden."
        }
      ]}
      screenshot={
        <Screenshot title="Klantdetail met FortiGates">
          <ScreenshotCards items={["FortiGates 4", "Backups 128", "Laatste backup CHANGED"]} />
          <ScreenshotTable headers={["FortiGate", "Model", "Firmware", "Acties"]} rows={[["fw-hoofdkantoor", "FG-100F", "7.4.7", "Open"], ["fw-datacenter", "FG-200F", "7.2.10", "Open"]]} />
          <Callout x="right-10" y="top-24" label="Klik Open voor alle firewallacties." />
        </Screenshot>
      }
    />
  );
}

function BackupManual() {
  return (
    <ManualSection
      number="04"
      title="Backup draaien, downloaden en verschillen bekijken"
      description="Backupacties staan op de FortiGate-pagina. Unchanged runs blijven zichtbaar als logregel."
      steps={[
        {
          title: "Open de FortiGate",
          body: "Ga via Klant > FortiGate > Open naar de firewallpagina.",
          result: "Je ziet statuskaarten, firewallinformatie en recente logs."
        },
        {
          title: "Klik Backup draaien",
          body: "De portal haalt de configuratie op via de FortiGate API.",
          result: "Bij een wijziging wordt een nieuw bestand opgeslagen. Bij gelijke config komt er UNCHANGED."
        },
        {
          title: "Download de laatste backup",
          body: "Gebruik Laatste backup downloaden wanneer er een opgeslagen configbestand is.",
          result: "Je downloadt het meest recente gewijzigde configbestand."
        },
        {
          title: "Open Backups en Diff",
          body: "Klik Backups. Gebruik de filter om unchanged te tonen of te verbergen. Klik Diff bij een gewijzigde backup.",
          result: "Rood toont verwijderde regels, groen toegevoegde regels."
        }
      ]}
      screenshot={
        <Screenshot title="FortiGate backupgeschiedenis">
          <ScreenshotCards items={["Laatste backup CHANGED", "Downloadbaar 42 KB", "Laatste change vandaag"]} />
          <ScreenshotTable headers={["Datum", "Status", "Autotask", "Acties"]} rows={[["Vandaag 10:44", "CHANGED", "Ticket 12345", "Download | Diff"], ["Vandaag 08:00", "UNCHANGED", "-", "Geen bestand"], ["Gisteren 22:00", "FAILED", "Fout", "Geen bestand"]]} />
          <Callout x="right-12" y="bottom-10" label="Gebruik Diff alleen op opgeslagen gewijzigde backups." />
        </Screenshot>
      }
    />
  );
}

function TenantSettingsManual({ globalContext }: { globalContext: boolean }) {
  return (
    <ManualSection
      number="05"
      title="Tenantinstellingen beheren"
      description={globalContext ? "Global ziet ook platforminstellingen. Tenantgebruikers zien alleen tenantinstellingen." : "Deze instellingen gelden alleen voor de actieve tenant."}
      steps={[
        {
          title: "Open Instellingen",
          body: "Klik op Instellingen in de navigatie.",
          result: "Je ziet tabs die passen bij je rechten en context."
        },
        {
          title: "Controleer Portal en tijdzone",
          body: "Zet de publieke URL en tijdzone. De tijdzone wordt gebruikt in logs, backups en planning.",
          result: "Datums en notificaties sluiten aan op de tenant."
        },
        {
          title: "Configureer mail",
          body: "Kies SMTP, Microsoft Graph of System. System gebruikt de Global mailinstellingen.",
          result: "Onboarding en backupnotificaties kunnen mail versturen."
        },
        {
          title: "Configureer integraties",
          body: "Zet IT Glue of Autotask alleen aan als de benodigde klant- en firewall-ID's zijn ingevuld.",
          result: "Backupbestanden en backupreports worden naar de juiste externe klant gekoppeld."
        }
      ]}
      screenshot={
        <Screenshot title="Instellingen">
          <ScreenshotTabs items={globalContext ? ["Mail", "SSO", "Scheduler", "Updates"] : ["Portal", "IT Glue", "Autotask", "Mail", "SSO", "Backupschema"]} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ScreenshotField label="Provider" value="Microsoft Graph" />
            <ScreenshotField label="Testmail" value="admin@example.nl" />
          </div>
          <Callout x="left-8" y="top-20" label="Tabs verschillen per Global of tenant." />
        </Screenshot>
      }
    />
  );
}

function RolesManual({ globalContext }: { globalContext: boolean }) {
  return (
    <ManualSection
      number="06"
      title="Rollen en rechten instellen"
      description="Rollen zijn per tenant onafhankelijk. De matrix toont welke rol welke permissies heeft."
      steps={[
        {
          title: "Open Rollen",
          body: "Ga naar Rollen in de navigatie.",
          result: "Je ziet een matrix met rollen van minste naar meeste rechten."
        },
        {
          title: "Maak een custom rol",
          body: "Klik Rol toevoegen. Geef naam en omschrijving en vink de gewenste permissions aan.",
          result: "De rol is beschikbaar voor gebruikers in deze tenant."
        },
        {
          title: "Verwijder alleen lege rollen",
          body: "Een rol kan alleen weg als er geen gebruikers aan gekoppeld zijn.",
          result: "Gebruikers verliezen nooit ongemerkt hun toegang."
        },
        {
          title: "Controleer platformrechten",
          body: globalContext ? "Platform permissions zie je alleen in Global." : "Tenantgebruikers zien geen platform permissions.",
          result: "De matrix blijft relevant voor de actieve context."
        }
      ]}
      screenshot={
        <Screenshot title="Rollenmatrix">
          <ScreenshotTable headers={["Permission", "Viewer", "Operator", "Tenant Admin"]} rows={[["Klanten bekijken", "x", "x", "x"], ["Backup draaien", "-", "x", "x"], ["Instellingen wijzigen", "-", "-", "x"]]} />
          <Callout x="right-10" y="top-16" label="Checkboxen bepalen de rechten per rol." />
        </Screenshot>
      }
    />
  );
}

function AuditManual({ globalContext }: { globalContext: boolean }) {
  return (
    <ManualSection
      number="07"
      title="Auditlog gebruiken"
      description={globalContext ? "Global kan platformaudit bekijken. Tenantcontext toont tenant-audit." : "Tenant audit toont alleen acties binnen deze tenant."}
      steps={[
        {
          title: "Open Audit",
          body: "Klik Audit in de navigatie.",
          result: "Je ziet wie welke actie heeft uitgevoerd."
        },
        {
          title: "Lees actor en uitkomst",
          body: "Controleer naam/e-mail, actie, uitkomst en doelobject.",
          result: "Success, failure en denied zijn direct herkenbaar."
        },
        {
          title: "Gebruik details",
          body: "Metadata toont context zoals backup-ID, permission, tenant of integratiekanaal.",
          result: "Je kunt incidenten en wijzigingen reconstrueren."
        }
      ]}
      screenshot={
        <Screenshot title="Auditlog">
          <ScreenshotTable headers={["Tijd", "Gebruiker", "Actie", "Uitkomst"]} rows={[["10:44", "Marco", "Backup gewijzigd", "Gelukt"], ["10:40", "Operator", "Toegang geweigerd", "Geweigerd"], ["09:15", "System", "Autotask ticket", "Gelukt"]]} />
          <Callout x="right-8" y="bottom-10" label="Andere tenants zijn niet zichtbaar." />
        </Screenshot>
      }
    />
  );
}

function TenantArchiveManual() {
  return (
    <ManualSection
      number="08"
      title="Tenant backup en restore"
      description="Alleen Global kan tenantdata exporteren of herstellen."
      steps={[
        {
          title: "Open Tenants",
          body: "Ga vanuit Global naar Tenants.",
          result: "Je ziet per tenant acties voor backup en restore."
        },
        {
          title: "Download Backup zip",
          body: "Klik Backup zip bij de tenant.",
          result: "De zip bevat tenantinstellingen, klanten, FortiGates, backupmetadata en configbestanden in klantmappen."
        },
        {
          title: "Restore uitvoeren",
          body: "Upload de tenant backup zip bij een bestaande tenant of via tenant restore.",
          result: "De tenantdata wordt vervangen of een ontbrekende tenant wordt aangemaakt."
        }
      ]}
      screenshot={
        <Screenshot title="Tenant backup">
          <ScreenshotTable headers={["Tenant", "Klanten", "Status", "Acties"]} rows={[["Klant A", "12", "Actief", "Backup zip | Restore"], ["Klant B", "4", "Actief", "Backup zip"]]} />
          <Callout x="right-8" y="top-20" label="Backup zip bevat klantmappen met FortiGates." />
        </Screenshot>
      }
    />
  );
}

function UpdateManual() {
  return (
    <ManualSection
      number="09"
      title="Applicatie update starten"
      description="Updates worden vanuit Global gestart. Tijdens de update is de interface tijdelijk niet beschikbaar."
      steps={[
        {
          title: "Open Global instellingen",
          body: "Ga naar Global > Instellingen > Updates.",
          result: "Je ziet lokale commit, GitHub commit, versie en update-status."
        },
        {
          title: "Start de update",
          body: "Klik Check en update nu.",
          result: "De starter ziet realtime logs. Andere ingelogde gebruikers zien direct het onderhoudsscherm zonder log."
        },
        {
          title: "Wacht op afronding",
          body: "De update voert self-backup, git pull, install, migraties, build en service restart uit.",
          result: "Na afronden wordt de starter teruggestuurd naar de laatste pagina."
        }
      ]}
      screenshot={
        <Screenshot title="Update onderhoudsscherm">
          <div className="rounded-md border border-amber-300/40 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-semibold">Applicatie update wordt uitgevoerd</p>
            <p className="mt-2 text-sm">Interface tijdelijk niet beschikbaar.</p>
          </div>
          <div className="mt-4 rounded-md border border-border bg-slate-950 p-4 font-mono text-xs text-slate-100">
            --- update started ---<br />
            pnpm install<br />
            prisma migrate deploy<br />
            next build
          </div>
          <Callout x="right-8" y="bottom-12" label="Alleen de starter ziet deze live log." />
        </Screenshot>
      }
    />
  );
}

function BreakGlassManual() {
  return (
    <ManualSection
      number="10"
      title="Break-glass SSO herstel"
      description="Gebruik dit alleen wanneer SSO niet meer werkt en je Global SSO moet uitschakelen."
      steps={[
        {
          title: "Log in op de server",
          body: "Open een shell op de server waar de portal draait.",
          result: "Je werkt lokaal in de applicatiemap."
        },
        {
          title: "Maak de eenmalige link",
          body: "Draai: pnpm break-glass:settings -- --email=admin@example.nl",
          result: "De CLI print een 15 minuten geldige link."
        },
        {
          title: "Open de link",
          body: "Open de link vanaf een vertrouwd apparaat.",
          result: "Je komt alleen in Global SSO-instellingen."
        },
        {
          title: "Zet SSO uit",
          body: "Schakel Microsoft Entra ID SSO uit en sla op.",
          result: "Lokale login kan weer worden gebruikt."
        }
      ]}
      screenshot={
        <Screenshot title="Break-glass sessie">
          <ScreenshotTabs items={["SSO"]} />
          <div className="mt-4 rounded-md border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Microsoft Entra ID SSO</p>
            <p className="mt-2 text-sm text-muted-foreground">SSO actief: uitgeschakeld</p>
          </div>
          <Callout x="right-8" y="top-16" label="Alleen SSO instellingen zijn toegankelijk." />
        </Screenshot>
      }
    />
  );
}

function ManualSection({
  number,
  title,
  description,
  steps,
  screenshot
}: {
  number: string;
  title: string;
  description: string;
  steps: ManualStep[];
  screenshot: React.ReactNode;
}) {
  return (
    <Panel title={`${number}. ${title}`} description={description}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
        <ol className="grid gap-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-md border border-border bg-surface-soft p-4">
              <div className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
                  {step.result ? (
                    <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                      Resultaat: {step.result}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {screenshot}
      </div>
    </Panel>
  );
}

function Screenshot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface shadow-sm shadow-slate-900/5">
      <div className="flex items-center justify-between border-b border-border bg-surface-soft px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Screenshot</p>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">Voorbeeld</span>
      </div>
      <div className="relative min-h-64 p-4">{children}</div>
    </div>
  );
}

function ScreenshotBar({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-[hsl(var(--header))] p-3 text-xs text-[hsl(var(--header-foreground))]">
      {items.map((item) => (
        <span key={item} className="rounded border border-white/10 bg-white/[0.06] px-2 py-1">
          {item}
        </span>
      ))}
    </div>
  );
}

function ScreenshotCards({ items }: { items: string[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {items.map((item) => (
        <div key={item} className="rounded-md border border-border bg-surface-soft p-3 text-sm font-medium">
          {item}
        </div>
      ))}
    </div>
  );
}

function ScreenshotTabs({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface-soft p-2">
      {items.map((item, index) => (
        <span key={item} className={index === 0 ? "rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground" : "rounded bg-surface px-3 py-1.5 text-xs font-medium"}>
          {item}
        </span>
      ))}
    </div>
  );
}

function ScreenshotTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-soft text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("-")} className="border-t border-border">
              {row.map((cell) => (
                <td key={cell} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScreenshotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Callout({ label, x, y }: { label: string; x: string; y: string }) {
  return (
    <div className={`absolute ${x} ${y} max-w-52 rounded-md border border-primary/30 bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-lg shadow-primary/20`}>
      {label}
    </div>
  );
}

function QuickTile({ title, body, active = false }: { title: string; body: string; active?: boolean }) {
  return (
    <section className={active ? "rounded-md border border-primary/35 bg-primary/10 p-4" : "rounded-md border border-border bg-surface-soft p-4"}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </section>
  );
}
