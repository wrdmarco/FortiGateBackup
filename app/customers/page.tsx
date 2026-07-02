import { createCustomer } from "@/app/actions";
import { Modal } from "@/components/modal";
import { ActionLink, Badge, Button, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { mainTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requireUser();
  const globalTenantId = isSuperAdmin(user) ? await mainTenantId() : null;
  const activeTenantId = isSuperAdmin(user) ? user.activeTenantId ?? globalTenantId ?? "" : user.tenantId ?? "";
  const isGlobalContext = Boolean(activeTenantId && activeTenantId === globalTenantId);
  const customerWhere = { tenantId: activeTenantId };
  const customers = await prisma.customer.findMany({
    where: customerWhere,
    include: { tenant: true, devices: true },
    orderBy: { name: "asc" }
  });

  return (
    <Shell>
      <PageHeader
        title="Klanten"
        description="Beheer klanten als startpunt voor FortiGates, backups, downloads en configuratiediffs."
        actions={!isGlobalContext ? (
          <Modal
            title="Klant toevoegen"
            description="Maak een klantkaart aan voor FortiGates, backups en beheer."
            trigger={<Button>Klant toevoegen</Button>}
          >
            <form action={createCustomer} className="grid gap-4">
              <input type="hidden" name="tenantId" value={activeTenantId} />
              <Field label="Naam" name="name" required />
              <Field label="Contactpersoon" name="contact" />
              <Field label="E-mail" name="email" type="email" />
              <Field label="Telefoon" name="phone" />
              <Field label="IT Glue organization ID" name="itGlueOrganizationId" />
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Notities</span>
                <textarea className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" name="notes" />
              </label>
              <Button>Opslaan</Button>
            </form>
          </Modal>
        ) : null}
      />
      {isGlobalContext ? (
        <div className="rounded-md border border-border bg-surface-soft p-4 text-sm text-muted-foreground">
          Global is alleen voor platformbeheer. Wissel naar een tenant om klanten te beheren.
        </div>
      ) : null}
      <div className="mt-6">
        <TableShell>
          <table className="table-pro w-full text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Klant</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">FortiGates</th>
                <th className="px-3 py-2">IT Glue</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{customer.name}</td>
                  <td className="px-3 py-2">{customer.tenant.name}</td>
                  <td className="px-3 py-2">{customer.email ?? customer.contact ?? "-"}</td>
                  <td className="px-3 py-2"><Badge>{customer.devices.length}</Badge></td>
                  <td className="px-3 py-2">
                    {customer.itGlueOrganizationId ? <Badge tone="success">Org {customer.itGlueOrganizationId}</Badge> : <Badge>Niet gekoppeld</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <ActionLink href={`/customers/${customer.id}`}>Beheren</ActionLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>
    </Shell>
  );
}
