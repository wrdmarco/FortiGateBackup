import { Badge, Card, PageHeader, Panel, Shell } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const activeTenantId = user.activeTenantId ?? user.tenantId ?? null;
  const globalContext = await isGlobalTenantId(activeTenantId);
  const tenantName = user.activeTenant?.name ?? user.tenant?.name ?? "Geen tenant";

  return (
    <Shell>
      <PageHeader
        title="Profiel"
        description="Je actuele account- en tenantcontext binnen de FortiGate Backup Portal."
        actions={<Badge tone={user.active ? "success" : "danger"}>{user.active ? "Actief" : "Inactief"}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Accountgegevens">
          <div className="grid gap-4 md:grid-cols-2">
            <Info label="Naam" value={user.name ?? "-"} />
            <Info label="E-mail" value={user.email} />
            <Info label="Rol" value={user.role} />
            <Info label="Actieve tenant" value={tenantName} />
          </div>
        </Panel>

        <div className="grid gap-4">
          <Card title="Context" value={globalContext ? "Global" : "Tenant"} detail={globalContext ? "Platformbeheer" : "Tenantdata"} />
          <Card title="Wachtwoord" value={user.mustChangePassword ? "Wijzigen" : "In orde"} detail={user.mustChangePassword ? "Tijdelijk wachtwoord actief" : "Geen verplichte wijziging"} />
        </div>
      </div>
    </Shell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-sm font-medium">{value}</p>
    </div>
  );
}
