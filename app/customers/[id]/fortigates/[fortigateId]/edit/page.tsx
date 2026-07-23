import { notFound } from "next/navigation";
import { updateFortiGate } from "@/app/actions";
import { ActionLink, Button, Field, PageHeader, Shell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isItGlueEnabled } from "@/lib/itglue";

export const dynamic = "force-dynamic";

export default async function EditCustomerFortiGatePage({
  params
}: {
  params: Promise<{ id: string; fortigateId: string }>;
}) {
  const user = await requirePermission("fortigates.update");
  const { id, fortigateId } = await params;
  const device = await prisma.fortiGate.findFirst({
    where: { id: fortigateId, customerId: id },
    include: { customer: { include: { tenant: true } } }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  const itGlueEnabled = await isItGlueEnabled(device.customer.tenantId);
  const detailHref = `/customers/${device.customerId}/fortigates/${device.id}`;

  return (
    <Shell>
      <PageHeader
        title="FortiGate bewerken"
        description={`${device.customer.name} - ${device.hostname ?? device.managementUrl}`}
        actions={<ActionLink href={detailHref}>Terug naar firewall</ActionLink>}
      />
      <form action={updateFortiGate} className="grid max-w-3xl gap-4 rounded-md border border-border bg-surface p-5 shadow-sm">
        <input type="hidden" name="id" value={device.id} />
        <input type="hidden" name="customerId" value={device.customerId} />
        <input type="hidden" name="returnTo" value={detailHref} />
        <div className="rounded-md border border-border bg-surface-soft p-4 text-sm">
          <p className="font-semibold">{device.customer.name}</p>
          <p className="mt-1 text-muted-foreground">Deze FortiGate blijft gekoppeld aan deze klant. Verplaatsen doe je bewust via datamigratie, niet tijdens normaal beheer.</p>
        </div>
        <Field label="Management URL" name="managementUrl" type="url" defaultValue={device.managementUrl} required />
        <Field label="HTTPS poort" name="httpsPort" type="number" defaultValue={device.httpsPort ?? 443} required />
        <Field label="Nieuwe API-token" name="apiToken" />
        <p className="-mt-2 text-xs text-muted-foreground">Laat leeg om de bestaande API-token te behouden.</p>
        <Field label="VDOM" name="vdom" defaultValue={device.vdom ?? ""} />
        {itGlueEnabled ? (
          <Field label="IT Glue configuration ID" name="itGlueConfigurationId" defaultValue={device.itGlueConfigurationId ?? ""} />
        ) : null}
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Schema</span>
          <select
            className="rounded-md border border-border bg-surface px-3 py-2"
            name="scheduleType"
            defaultValue={device.scheduleType ?? "DAILY"}
          >
            <option value="MANUAL">Alleen handmatig</option>
            <option value="HOURLY">Elk uur</option>
            <option value="DAILY">Dagelijks</option>
            <option value="WEEKLY">Wekelijks</option>
            <option value="MONTHLY">Maandelijks</option>
            <option value="CRON">Cron</option>
          </select>
        </label>
        <Field label="Cron expressie" name="cronExpression" defaultValue={device.cronExpression ?? ""} />
        <input name="tlsVerify" type="hidden" value="true" />
        <div className="rounded-md border border-border bg-surface-soft p-4 text-sm">
          <p className="font-medium">TLS is altijd ingeschakeld</p>
          <p className="mt-1 text-muted-foreground">
            Wijzig je host of poort, dan vervalt een eerder geaccepteerde fingerprint. Controleer daarna opnieuw het TLS-certificaat op de FortiGate-pagina.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button>Wijzigingen opslaan</Button>
          <ActionLink href={detailHref}>Annuleren</ActionLink>
        </div>
      </form>
    </Shell>
  );
}
