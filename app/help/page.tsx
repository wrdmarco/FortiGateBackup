import { Badge, PageHeader, Panel, Shell } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

const tenantWorkflow = [
  {
    title: "1. Klant aanmaken",
    body: "Maak eerst een klant aan. FortiGates horen altijd onder een klant, zodat backups, logs en integraties netjes gescheiden blijven."
  },
  {
    title: "2. FortiGate toevoegen",
    body: "Open de klant en voeg daar de firewall toe. Vul de management URL, poort en API-token in. IT Glue configuration ID is alleen nodig als IT Glue actief is."
  },
  {
    title: "3. Backup draaien",
    body: "Open de FortiGate. Daar staan de firewallacties, waaronder handmatig backup draaien, laatste backup downloaden en backupgeschiedenis bekijken."
  },
  {
    title: "4. Verschillen controleren",
    body: "In de backupgeschiedenis zie je alle runs. Gebruik Diff bij gewijzigde backups om rood verwijderde regels en groen toegevoegde regels te bekijken."
  }
];

const settings = [
  ["Portal", "Publieke tenant-URL en tijdzone. De tijdzone wordt gebruikt voor datums, logs, backups en planning."],
  ["Mail", "SMTP, Microsoft Graph of System mail. System gebruikt de Global mailinstellingen voor die tenant."],
  ["SSO", "Microsoft Entra ID login per Global of tenant. Gebruik lokale login als fallback."],
  ["Backupschema", "Automatische backupfrequentie, retries, retentie en notificatiekanalen."],
  ["IT Glue", "Upload gewijzigde configbestanden naar de gekoppelde IT Glue configuration."],
  ["Autotask", "Maak backupreports als ticket onder de gekoppelde Autotask klant met queue, priority en worktype."],
  ["Updates", "Alleen in Global. Start een portalupdate en volg als starter realtime de update-log."]
] as const;

const roles = [
  ["Super Admin", "Platformbeheer in Global. Kan tenants wisselen, updates draaien en platforminstellingen beheren."],
  ["Tenant Admin", "Volledig beheer binnen een tenant, zonder platformrechten."],
  ["Operator", "Dagelijks beheer van klanten, FortiGates en backups zonder instellingen."],
  ["Backup Operator", "Backups bekijken, vergelijken, downloaden en starten."],
  ["Auditor", "Lezen, auditlogs en diffs bekijken."],
  ["Viewer", "Alleen lezen zonder downloadrechten."]
] as const;

export default async function HelpPage() {
  const user = await requireUser();
  const activeTenantId = user.activeTenantId ?? user.tenantId ?? null;
  const globalContext = await isGlobalTenantId(activeTenantId);
  const visibleSettings = globalContext ? settings : settings.filter(([name]) => name !== "Updates");
  const visibleRoles = globalContext ? roles : roles.filter(([name]) => name !== "Super Admin");

  return (
    <Shell>
      <PageHeader
        title="Help"
        description="Praktische handleiding voor dagelijks gebruik, tenantbeheer, backups, integraties en herstelprocedures."
        actions={<Badge tone={globalContext ? "warning" : "success"}>{globalContext ? "Global context" : "Tenant context"}</Badge>}
      />

      <div className="grid gap-6">
        {globalContext ? (
          <Panel title="Hoe de portal is opgebouwd" description="De portal is tenant-gescheiden. Global is voor platformbeheer; klantdata hoort in tenants.">
            <div className="grid gap-4 md:grid-cols-3">
              <HelpCard title="Global" body="Gebruik Global voor tenants, platformrollen, updates, globale maildefaults en platformaudit. Maak hier geen klanten of FortiGates aan." />
              <HelpCard title="Tenant" body="Gebruik een tenant voor klanten, FortiGates, backups, tenantinstellingen, integraties en tenant-audit." />
              <HelpCard title="Tenant switcher" body="Super admins kunnen bovenin wisselen van tenant. Na wisselen ga je naar het dashboard van die tenant." />
            </div>
          </Panel>
        ) : (
          <Panel title="Hoe deze tenant werkt" description="Binnen een tenant beheer je alleen de data en instellingen van deze tenant.">
            <div className="grid gap-4 md:grid-cols-2">
              <HelpCard title="Tenantdata" body="Klanten, FortiGates, backups, logs, gebruikers en instellingen zijn gescheiden van andere tenants." />
              <HelpCard title="Context" body="Alles wat je hier ziet en wijzigt hoort bij de actieve tenant bovenin de balk." />
            </div>
          </Panel>
        )}

        <Panel title="Dagelijkse workflow" description="Werk altijd van klant naar firewall naar backup. Zo blijft de context correct.">
          <div className="grid gap-3 md:grid-cols-2">
            {tenantWorkflow.map((item) => (
              <HelpCard key={item.title} title={item.title} body={item.body} />
            ))}
          </div>
        </Panel>

        <Panel title="Backups en meldingen" description="Backups worden per FortiGate opgeslagen en gekoppeld aan de tenant van de klant.">
          <div className="grid gap-4 lg:grid-cols-2">
            <HelpList
              title="Backupstatussen"
              items={[
                ["CHANGED", "Er is een nieuw configbestand opgeslagen. Deze backup kan worden gedownload en vergeleken."],
                ["UNCHANGED", "De FortiGate is bereikt, maar de config is gelijk aan de laatste opgeslagen backup."],
                ["FAILED", "De backup is mislukt. De fout staat bij de backupregel en in de FortiGate logs."]
              ]}
            />
            <HelpList
              title="Notificaties"
              items={[
                ["Mail", "Stuur success en/of failed meldingen naar ingestelde ontvangers."],
                ["Webhook", "Stuur een JSON payload naar een extern HTTPS endpoint."],
                ["Autotask", "Maak een ticket onder de klant met ingestelde queue, priority en worktype."],
                ["IT Glue", "Upload alleen gewijzigde backupbestanden als bijlage op de gekoppelde configuration."]
              ]}
            />
          </div>
        </Panel>

        <Panel title="Instellingen" description="Instellingen worden in de database opgeslagen en zijn tenant-afhankelijk, behalve platforminstellingen in Global.">
          <div className="overflow-auto rounded-md border border-border bg-surface">
            <table className="table-pro w-full min-w-[820px] text-left text-sm">
              <thead className="bg-surface-soft">
                <tr>
                  <th>Onderdeel</th>
                  <th>Waarvoor gebruik je dit?</th>
                </tr>
              </thead>
              <tbody>
                {visibleSettings.map(([name, description]) => (
                  <tr key={name} className="border-t border-border">
                    <td className="font-medium">{name}</td>
                    <td className="text-muted-foreground">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Rollen en rechten" description="Rechten zijn per tenant onafhankelijk. Custom rollen kunnen worden aangemaakt en verwijderd zolang er geen leden aan hangen.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleRoles.map(([name, description]) => (
              <HelpCard key={name} title={name} body={description} />
            ))}
          </div>
        </Panel>

        <Panel title="Audit en tenantdata" description="Auditregels blijven tenant-gescheiden en tonen wie wat heeft gedaan.">
          <div className="grid gap-4 md:grid-cols-3">
            <HelpCard title="Auditlog" body="Bekijk acties zoals login, tenantwissel, instellingen, backups, failures en geweigerde permissies." />
            {globalContext ? (
              <>
                <HelpCard title="Tenant backup" body="Global kan tenantdata exporteren als zip. Klanten, FortiGates en backupmetadata blijven in klantmappen gescheiden." />
                <HelpCard title="Tenant restore" body="Een tenant backup kan een bestaande tenant vervangen of een ontbrekende tenant opnieuw aanmaken." />
              </>
            ) : (
              <>
                <HelpCard title="Tenant logs" body="FortiGate logs en backupregels tonen alleen gegevens binnen deze tenant." />
                <HelpCard title="Tenantgrenzen" body="Auditregels van andere tenants zijn hier niet zichtbaar." />
              </>
            )}
          </div>
        </Panel>

        {globalContext ? (
          <Panel title="Beheer en noodherstel" description="Alleen relevant voor platformbeheerders.">
            <div className="grid gap-4 lg:grid-cols-2">
              <HelpCard
                title="Applicatie update"
                body="Start updates via Global instellingen. Tijdens de update ziet iedereen een onderhoudsscherm. De starter ziet realtime logs en wordt na afronden teruggestuurd."
              />
              <HelpCard
                title="Break-glass SSO herstel"
                body="Als SSO stuk is, maak op de server een eenmalige link met pnpm break-glass:settings. Deze link opent alleen Global SSO-instellingen zodat SSO kan worden uitgezet."
              />
            </div>
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}

function HelpCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-md border border-border bg-surface-soft p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </section>
  );
}

function HelpList({ title, items }: { title: string; items: readonly (readonly [string, string])[] }) {
  return (
    <section className="rounded-md border border-border bg-surface-soft p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3">
        {items.map(([label, body]) => (
          <div key={label} className="rounded-md border border-border bg-surface p-3">
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
