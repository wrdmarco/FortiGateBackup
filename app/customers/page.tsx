import { createCustomer } from "@/app/actions";
import { Modal } from "@/components/modal";
import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { ActionLink, Badge, Button, Field, FilterBar, PageHeader, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function CustomersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("customers.read");
  const queryParams = await searchParams;
  const query = firstQueryValue(queryParams.q);
  const requestedPage = parsePageParam(queryParams.page);
  const activeTenantId = tenantFilter(user) ?? "";
  const isGlobalContext = await isGlobalTenantId(activeTenantId);
  const canCreateCustomer = await hasPermission(user, "customers.create");
  const customerWhere = {
    tenantId: isGlobalContext ? "__global_has_no_customers__" : activeTenantId,
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { contact: { contains: query } },
            { email: { contains: query } }
          ]
        }
      : {})
  };
  const totalCustomers = isGlobalContext ? 0 : await prisma.customer.count({ where: customerWhere });
  const page = normalizePage(requestedPage, totalCustomers, PAGE_SIZE);
  const customers = isGlobalContext
    ? []
    : await prisma.customer.findMany({
        where: customerWhere,
        include: {
          _count: { select: { devices: true } }
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE
      });

  return (
    <Shell>
      <PageHeader
        title="Klanten"
        description="Beheer klanten als startpunt voor FortiGates, backups, downloads en configuratiediffs."
        actions={!isGlobalContext && canCreateCustomer ? (
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
              <Field label="Autotask Company ID" name="autotaskCompanyId" />
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
      {!isGlobalContext ? <div className="mt-6">
        <FilterBar><form className="flex flex-wrap items-end gap-3" method="get">
          <label className="grid min-w-64 flex-1 gap-1 text-sm">
            <span className="font-medium">Zoeken</span>
            <input
              className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              defaultValue={query}
              name="q"
              placeholder="Naam, contactpersoon of e-mail"
            />
          </label>
          <Button variant="secondary">Zoeken</Button>
          {query ? <ActionLink href="/customers">Filter wissen</ActionLink> : null}
        </form></FilterBar>
        <TableShell>
          <table className="table-pro w-full text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Klant</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">FortiGates</th>
                <th className="px-3 py-2">Integraties</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{customer.name}</td>
                  <td className="px-3 py-2">{customer.email ?? customer.contact ?? "-"}</td>
                  <td className="px-3 py-2"><Badge>{customer._count.devices}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {customer.itGlueOrganizationId ? <Badge tone="success">IT Glue {customer.itGlueOrganizationId}</Badge> : null}
                      {customer.autotaskCompanyId ? <Badge tone="success">Autotask {customer.autotaskCompanyId}</Badge> : null}
                      {!customer.itGlueOrganizationId && !customer.autotaskCompanyId ? <Badge>Niet gekoppeld</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ActionLink href={`/customers/${customer.id}`}>Beheren</ActionLink>
                  </td>
                </tr>
              ))}
              {!customers.length ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>Geen klanten gevonden.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
        <ServerPagination
          itemLabel="klanten"
          page={page}
          pageSize={PAGE_SIZE}
          path="/customers"
          query={{ q: query }}
          totalItems={totalCustomers}
        />
      </div> : null}
    </Shell>
  );
}
