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

  return globalContext ? <GlobalManual /> : <TenantManual />;
}

function GlobalManual() {
  return (
    <Shell>
      <PageHeader
        title="Global handleiding"
        description="Handleiding voor platformbeheer: tenants, gebruikers, globale instellingen, updates, tenant backup/restore en noodherstel."
        actions={<Badge tone="warning">Global manual</Badge>}
      />
      <div className="grid gap-6">
        <GlobalIntro />
        <GlobalTenantSwitchManual />
        <GlobalTenantManagementManual />
        <GlobalUsersRolesManual />
        <GlobalSettingsManual />
        <GlobalAuditManual />
        <TenantArchiveManual />
        <UpdateManual />
        <BreakGlassManual />
      </div>
    </Shell>
  );
}

function TenantManual() {
  return (
    <Shell>
      <PageHeader
        title="Tenant handleiding"
        description="Handleiding voor tenantgebruik: klanten, FortiGates, backups, tenantinstellingen, rollen en audit binnen deze tenant."
        actions={<Badge tone="success">Tenant manual</Badge>}
      />
      <div className="grid gap-6">
        <TenantIntro />
        <TenantCustomerManual />
        <TenantFortiGateManual />
        <TenantBackupManual />
        <TenantIntegrationsManual />
        <TenantUsersRolesManual />
        <TenantAuditManual />
      </div>
    </Shell>
  );
}

function GlobalIntro() {
  return (
    <Panel title="Zo gebruik je Global" description="Global is bedoeld voor platformbeheer. Klantdata hoort in tenants, niet in Global.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <p>Gebruik Global voor tenants, platformrollen, updates, globale maildefaults, audit en noodherstel.</p>
          <p>Wil je klantdata beheren, wissel dan eerst naar de juiste tenant met de tenant switcher.</p>
        </div>
        <Screenshot title="Global bovenbalk">
          <ScreenshotBar items={["FortiGate Backup", "Global", "Tenant switcher", "Gebruiker"]} />
          <Callout x="right-5" y="top-16" label="Global toont platformbeheer, geen klantbeheer." />
        </Screenshot>
      </div>
    </Panel>
  );
}

function TenantIntro() {
  return (
    <Panel title="Zo gebruik je een tenant" description="Binnen een tenant beheer je alleen data van die tenant. Andere tenants zijn niet zichtbaar.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <p>Werk vanuit Klanten naar FortiGates en daarna naar backups. Zo blijft iedere actie gekoppeld aan de juiste klant.</p>
          <p>Instellingen, rollen, audit en integraties gelden alleen voor de actieve tenant bovenin de balk.</p>
        </div>
        <Screenshot title="Tenant bovenbalk">
          <ScreenshotBar items={["Dashboard", "Klanten", "Alerts", "Rollen", "Audit", "Instellingen"]} />
          <Callout x="right-5" y="top-16" label="Alle menu-items horen bij deze tenant." />
        </Screenshot>
      </div>
    </Panel>
  );
}

function GlobalTenantSwitchManual() {
  return (
    <ManualSection
      number="01"
      title="Naar een tenant wisselen"
      description="Gebruik de tenant switcher om klantdata of tenantinstellingen te beheren."
      steps={[
        { title: "Open de tenant switcher", body: "Klik bovenin op Global of de actieve tenantnaam.", result: "Je ziet de lijst met actieve tenants." },
        { title: "Kies een tenant", body: "Selecteer de tenant waarin je wilt werken.", result: "De portal opent het dashboard van die tenant." },
        { title: "Controleer de context", body: "Controleer rechtsboven of de juiste tenant actief is.", result: "Alle acties en auditregels horen nu bij die tenant." }
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
      title="Tenant aanmaken"
      description="Maak een tenant inclusief eerste beheerder. Dit kan alleen vanuit Global."
      steps={[
        { title: "Open Tenants", body: "Ga in Global naar Tenants.", result: "Je ziet alle tenants en hun acties." },
        { title: "Klik Tenant toevoegen", body: "Vul tenantnaam, adminnaam, admin e-mail en eventueel custom domein in.", result: "De portal bereidt de tenant en admin voor." },
        { title: "Laat de uitnodiging versturen", body: "Mail moet werken voordat de tenant wordt aangemaakt.", result: "De admin ontvangt een tijdelijk wachtwoord en moet dit wijzigen." }
      ]}
      screenshot={
        <Screenshot title="Tenantoverzicht">
          <ScreenshotTable headers={["Tenant", "Status", "Gebruikers", "Acties"]} rows={[["Klant A", "Actief", "2", "Beheren"], ["Klant B", "Actief", "1", "Backup zip"]]} />
          <Callout x="right-8" y="top-8" label="Tenant toevoegen staat in Global." />
        </Screenshot>
      }
    />
  );
}

function GlobalUsersRolesManual() {
  return (
    <ManualSection
      number="03"
      title="Platformgebruikers en rollen beheren"
      description="Gebruik Global voor platformrollen en gebruikersbeheer over tenants heen."
      steps={[
        { title: "Open Gebruikers", body: "Bekijk platformgebruikers en tenantgebruikers waarvoor je rechten hebt.", result: "Je ziet naam, e-mail, tenant en actieve status." },
        { title: "Open Rollen", body: "Bekijk de rollenmatrix. Global toont ook platform permissions.", result: "Platformrechten staan alleen in Global." },
        { title: "Maak of wijzig rollen", body: "Custom rollen maak je via de rolmodal. Verwijderen kan alleen als er geen leden zijn.", result: "Rechten blijven controleerbaar per tenant." }
      ]}
      screenshot={
        <Screenshot title="Global rollenmatrix">
          <ScreenshotTable headers={["Permission", "Viewer", "Tenant Admin", "Super Admin"]} rows={[["Platform tenants bekijken", "-", "-", "x"], ["Updates starten", "-", "-", "x"], ["Tenant dashboard bekijken", "x", "x", "x"]]} />
          <Callout x="right-8" y="top-16" label="Platform permissions alleen in Global." />
        </Screenshot>
      }
    />
  );
}

function GlobalSettingsManual() {
  return (
    <ManualSection
      number="04"
      title="Global instellingen beheren"
      description="Global bevat platforminstellingen zoals globale mail, SSO, scheduler-engine en updates."
      steps={[
        { title: "Open Instellingen", body: "Ga in Global naar Instellingen.", result: "Je ziet Global tabs zoals Mail, SSO, Scheduler en Updates." },
        { title: "Configureer globale mail", body: "Gebruik SMTP of Microsoft Graph als standaard voor onboarding en tenants met System mail.", result: "Tenantuitnodigingen en system mail kunnen worden verstuurd." },
        { title: "Beheer SSO", body: "Configureer Microsoft Entra ID voor Global login.", result: "Platformbeheerders kunnen via SSO aanmelden." },
        { title: "Controleer Scheduler en Updates", body: "Beheer workerlimieten en start portalupdates vanuit de update-tab.", result: "Platformtaken blijven centraal beheerd." }
      ]}
      screenshot={
        <Screenshot title="Global instellingen">
          <ScreenshotTabs items={["Mail", "SSO", "Scheduler", "Updates"]} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ScreenshotField label="Mailprovider" value="Microsoft Graph" />
            <ScreenshotField label="Update status" value="Actueel" />
          </div>
          <Callout x="left-8" y="top-20" label="Global tabs zijn platformgericht." />
        </Screenshot>
      }
    />
  );
}

function GlobalAuditManual() {
  return (
    <ManualSection
      number="05"
      title="Platformaudit controleren"
      description="Gebruik Global audit voor platformacties zoals tenantbeheer, updates, tenantwissel en geweigerde platformrechten."
      steps={[
        { title: "Open Audit", body: "Klik Audit vanuit Global.", result: "Je ziet platformbrede auditregels waarvoor je rechten hebt." },
        { title: "Controleer actor en uitkomst", body: "Bekijk naam/e-mail, actie, doelobject en success/failure/denied.", result: "Je ziet wie wat heeft gedaan." },
        { title: "Gebruik details", body: "Open metadata voor context zoals tenant, permission of update-resultaat.", result: "Wijzigingen zijn reconstrueerbaar." }
      ]}
      screenshot={
        <Screenshot title="Global audit">
          <ScreenshotTable headers={["Tijd", "Gebruiker", "Actie", "Uitkomst"]} rows={[["10:44", "Marco", "Tenant aangemaakt", "Gelukt"], ["10:40", "Marco", "Update gestart", "Gelukt"], ["09:15", "Operator", "Toegang geweigerd", "Geweigerd"]]} />
          <Callout x="right-8" y="bottom-10" label="Platformacties staan hier." />
        </Screenshot>
      }
    />
  );
}

function TenantArchiveManual() {
  return (
    <ManualSection
      number="06"
      title="Tenant backup en restore"
      description="Alleen Global kan tenantdata exporteren of herstellen."
      steps={[
        { title: "Open Tenants", body: "Ga vanuit Global naar Tenants.", result: "Je ziet per tenant export- en restoreacties." },
        { title: "Download Backup zip", body: "Klik Backup zip bij de tenant.", result: "De zip bevat tenantinstellingen, klanten, FortiGates, backupmetadata en configbestanden in klantmappen." },
        { title: "Restore uitvoeren", body: "Upload de tenant backup zip bij een bestaande tenant of via tenant restore.", result: "De tenantdata wordt vervangen of een ontbrekende tenant wordt aangemaakt." }
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
      number="07"
      title="Applicatie update starten"
      description="Updates worden vanuit Global gestart. Tijdens de update is de interface tijdelijk niet beschikbaar."
      steps={[
        { title: "Open Updates", body: "Ga naar Global > Instellingen > Updates.", result: "Je ziet lokale commit, GitHub commit, versie en update-status." },
        { title: "Start de update", body: "Klik Check en update nu.", result: "De starter ziet realtime logs. Andere ingelogde gebruikers zien direct het onderhoudsscherm zonder log." },
        { title: "Wacht op afronding", body: "De update voert self-backup, git pull, install, migraties, build en service restart uit.", result: "Na afronden wordt de starter teruggestuurd naar de laatste pagina." }
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
      number="08"
      title="Break-glass SSO herstel"
      description="Gebruik dit alleen wanneer SSO niet meer werkt en je Global SSO moet uitschakelen."
      steps={[
        { title: "Log in op de server", body: "Open een shell op de server waar de portal draait.", result: "Je werkt lokaal in de applicatiemap." },
        { title: "Maak de eenmalige link", body: "Draai: pnpm break-glass:settings -- --email=admin@example.nl", result: "De CLI print een 15 minuten geldige link." },
        { title: "Open de link", body: "Open de link vanaf een vertrouwd apparaat.", result: "Je komt alleen in Global SSO-instellingen." },
        { title: "Zet SSO uit", body: "Schakel Microsoft Entra ID SSO uit en sla op.", result: "Lokale login kan weer worden gebruikt." }
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

function TenantCustomerManual() {
  return (
    <ManualSection
      number="01"
      title="Klant aanmaken en openen"
      description="Elke FortiGate hoort onder een klant. Begin daarom altijd op Klanten."
      steps={[
        { title: "Open Klanten", body: "Klik Klanten in de tenantnavigatie.", result: "Je ziet alleen klanten van deze tenant." },
        { title: "Klik Klant toevoegen", body: "Vul naam, contactgegevens en optionele integratie-ID's in.", result: "De klantkaart wordt aangemaakt." },
        { title: "Open de klant", body: "Klik Beheren bij de klant.", result: "Je ziet de klantdetailpagina met FortiGates en backupinformatie." }
      ]}
      screenshot={
        <Screenshot title="Klantenoverzicht">
          <ScreenshotTable headers={["Klant", "Contact", "FortiGates", "Acties"]} rows={[["Acme BV", "beheer@acme.nl", "4", "Beheren"], ["Contoso", "it@contoso.nl", "2", "Beheren"]]} />
          <Callout x="right-8" y="top-8" label="Gebruik Klant toevoegen voor een nieuwe klant." />
        </Screenshot>
      }
    />
  );
}

function TenantFortiGateManual() {
  return (
    <ManualSection
      number="02"
      title="FortiGate toevoegen"
      description="Voeg een firewall altijd toe vanuit de klant, zodat de klant automatisch klopt."
      steps={[
        { title: "Open de klant", body: "Ga naar Klanten en klik Beheren.", result: "De klantcontext is actief." },
        { title: "Klik FortiGate toevoegen", body: "Vul management URL, HTTPS poort, API-token, TLS verify en planning in.", result: "De firewall wordt aan deze klant gekoppeld." },
        { title: "Controleer optionele integraties", body: "Vul IT Glue configuration ID alleen in als IT Glue actief is.", result: "Backups kunnen later aan de juiste externe configuratie worden gekoppeld." },
        { title: "Open de FortiGate", body: "Klik Open op de FortiGate-regel.", result: "Je ziet firewallinformatie, logs en backupacties." }
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

function TenantBackupManual() {
  return (
    <ManualSection
      number="03"
      title="Backup draaien, downloaden en vergelijken"
      description="Backupacties staan op de FortiGate-pagina. Unchanged runs blijven zichtbaar als logregel."
      steps={[
        { title: "Open de FortiGate", body: "Ga via Klant > FortiGate > Open naar de firewallpagina.", result: "Je ziet statuskaarten, firewallinformatie en recente logs." },
        { title: "Klik Backup draaien", body: "De portal haalt de configuratie op via de FortiGate API.", result: "Bij een wijziging wordt een nieuw bestand opgeslagen. Bij gelijke config komt er UNCHANGED." },
        { title: "Download de laatste backup", body: "Gebruik Laatste backup downloaden wanneer er een opgeslagen configbestand is.", result: "Je downloadt het meest recente gewijzigde configbestand." },
        { title: "Open Backups en Diff", body: "Klik Backups. Gebruik de filter om unchanged te tonen of te verbergen. Klik Diff bij een gewijzigde backup.", result: "Rood toont verwijderde regels, groen toegevoegde regels." }
      ]}
      screenshot={
        <Screenshot title="Backupgeschiedenis">
          <ScreenshotCards items={["Laatste backup CHANGED", "Downloadbaar 42 KB", "Laatste change vandaag"]} />
          <ScreenshotTable headers={["Datum", "Status", "Autotask", "Acties"]} rows={[["Vandaag 10:44", "CHANGED", "Ticket 12345", "Download | Diff"], ["Vandaag 08:00", "UNCHANGED", "-", "Geen bestand"], ["Gisteren 22:00", "FAILED", "Fout", "Geen bestand"]]} />
          <Callout x="right-12" y="bottom-10" label="Gebruik Diff op gewijzigde backups." />
        </Screenshot>
      }
    />
  );
}

function TenantIntegrationsManual() {
  return (
    <ManualSection
      number="04"
      title="Tenantinstellingen en integraties beheren"
      description="Deze instellingen gelden alleen voor de actieve tenant."
      steps={[
        { title: "Open Instellingen", body: "Klik Instellingen in de tenantnavigatie.", result: "Je ziet tenanttabs zoals Portal, IT Glue, Autotask, Mail, SSO en Backupschema." },
        { title: "Zet tijdzone en portal URL", body: "Gebruik Portal voor publieke URL en tijdzone.", result: "Datums, logs, backups en notificaties gebruiken de juiste tenantcontext." },
        { title: "Configureer mail", body: "Kies SMTP, Microsoft Graph of System. System gebruikt de Global mailinstellingen.", result: "Backupnotificaties en gebruikersmails kunnen worden verzonden." },
        { title: "Configureer IT Glue of Autotask", body: "Zet integraties alleen aan als klant- en firewall-ID's bekend zijn.", result: "Backupbestanden en backupreports komen bij de juiste externe klant terecht." }
      ]}
      screenshot={
        <Screenshot title="Tenantinstellingen">
          <ScreenshotTabs items={["Portal", "IT Glue", "Autotask", "Mail", "SSO", "Backupschema"]} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ScreenshotField label="Mailprovider" value="System" />
            <ScreenshotField label="Backupschema" value="Dagelijks" />
          </div>
          <Callout x="left-8" y="top-20" label="Alle tabs gelden voor deze tenant." />
        </Screenshot>
      }
    />
  );
}

function TenantUsersRolesManual() {
  return (
    <ManualSection
      number="05"
      title="Tenantgebruikers en rollen beheren"
      description="Rollen zijn per tenant onafhankelijk. Tenantgebruikers zien geen platformrechten."
      steps={[
        { title: "Open Gebruikers", body: "Maak of wijzig gebruikers binnen deze tenant.", result: "Nieuwe gebruikers krijgen een tijdelijk wachtwoord per mail." },
        { title: "Open Rollen", body: "Bekijk de rollenmatrix voor tenantrechten.", result: "Je ziet geen Global platform permissions." },
        { title: "Maak een custom rol", body: "Klik Rol toevoegen en vink de gewenste tenantpermissions aan.", result: "De rol is beschikbaar binnen deze tenant." },
        { title: "Verwijder alleen lege rollen", body: "Een rol kan alleen weg als er geen gebruikers aan gekoppeld zijn.", result: "Toegang blijft voorspelbaar." }
      ]}
      screenshot={
        <Screenshot title="Tenant rollenmatrix">
          <ScreenshotTable headers={["Permission", "Viewer", "Operator", "Tenant Admin"]} rows={[["Klanten bekijken", "x", "x", "x"], ["Backup draaien", "-", "x", "x"], ["Instellingen wijzigen", "-", "-", "x"]]} />
          <Callout x="right-10" y="top-16" label="Alleen tenantpermissions." />
        </Screenshot>
      }
    />
  );
}

function TenantAuditManual() {
  return (
    <ManualSection
      number="06"
      title="Tenant auditlog gebruiken"
      description="Tenant audit toont alleen acties binnen deze tenant."
      steps={[
        { title: "Open Audit", body: "Klik Audit in de tenantnavigatie.", result: "Je ziet tenantacties en geen regels van andere tenants." },
        { title: "Lees actor en uitkomst", body: "Controleer naam/e-mail, actie, uitkomst en doelobject.", result: "Success, failure en denied zijn direct herkenbaar." },
        { title: "Gebruik details", body: "Metadata toont context zoals backup-ID, permission of integratiekanaal.", result: "Je kunt wijzigingen binnen deze tenant reconstrueren." }
      ]}
      screenshot={
        <Screenshot title="Tenant audit">
          <ScreenshotTable headers={["Tijd", "Gebruiker", "Actie", "Uitkomst"]} rows={[["10:44", "Operator", "Backup gewijzigd", "Gelukt"], ["10:40", "Admin", "Instellingen", "Gelukt"], ["09:15", "Viewer", "Toegang geweigerd", "Geweigerd"]]} />
          <Callout x="right-8" y="bottom-10" label="Andere tenants zijn niet zichtbaar." />
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
