import { notFound } from "next/navigation";
import { updateCustomer } from "@/app/actions";
import { ActionLink, Button, Field, PageHeader, Panel, Shell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("customers.update");
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id }, include: { tenant: true } });
  if (!customer) notFound();
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);

  return (
    <Shell>
      <PageHeader
        title={`${customer.name} bewerken`}
        description="Werk contactgegevens en externe integratiekoppelingen overzichtelijk bij."
        actions={<ActionLink href={`/customers/${customer.id}`} variant="secondary">Terug naar klant</ActionLink>}
      />
      <form action={updateCustomer} className="content-grid content-grid-aside">
        <input type="hidden" name="id" value={customer.id} />
        <Panel title="Klantgegevens" description="De gegevens die in het dagelijkse beheer worden gebruikt.">
          <div className="grid gap-5">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Naam" name="name" defaultValue={customer.name} required />
              <Field label="Contactpersoon" name="contact" defaultValue={customer.contact ?? ""} />
              <Field label="E-mail" name="email" type="email" defaultValue={customer.email ?? ""} />
              <Field label="Telefoon" name="phone" defaultValue={customer.phone ?? ""} />
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Notities</span>
              <textarea className="min-h-32 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" name="notes" defaultValue={customer.notes ?? ""} />
            </label>
            <Button>Wijzigingen opslaan</Button>
          </div>
        </Panel>
        <Panel title="Integraties" description="Technische sleutels voor synchronisatie met externe systemen.">
          <div className="grid gap-5">
            <Field label="IT Glue organization ID" name="itGlueOrganizationId" defaultValue={customer.itGlueOrganizationId ?? ""} />
            <Field label="Autotask Company ID" name="autotaskCompanyId" defaultValue={customer.autotaskCompanyId ?? ""} />
            <p className="text-sm text-muted-foreground">Integratievelden worden samen met de overige klantgegevens opgeslagen.</p>
          </div>
        </Panel>
      </form>
    </Shell>
  );
}
