import { createManagedTenant, deleteTenant, setTenantActive } from "@/app/actions";
import { Modal } from "@/components/modal";
import { Badge, Button, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  await requireSuperAdmin();
  const [tenants, mainTenant] = await Promise.all([
    prisma.tenant.findMany({
      include: {
        users: {
          where: { active: true },
          select: { id: true, name: true, email: true, role: true }
        },
        customers: {
          select: {
            id: true,
            devices: { select: { id: true } }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })
  ]);

  return (
    <Shell>
      <PageHeader
        title="Tenants"
        description="Alleen platformbeheerders kunnen tenants aanmaken. Tenantadmins beheren daarna uitsluitend hun eigen klanten, FortiGates, backups en instellingen."
        actions={
          <Modal
            title="Tenant aanmaken"
            description="Maak een tenant inclusief eerste tenantadmin."
            trigger={<Button>Tenant aanmaken</Button>}
          >
            <form action={createManagedTenant} className="grid gap-4">
              <Field label="Tenantnaam" name="name" required />
              <Field label="Slug" name="slug" required />
              <div className="border-t border-border pt-4">
                <h3 className="mb-3 font-semibold">Eerste tenantadmin</h3>
                <div className="grid gap-4">
                  <Field label="Admin naam" name="adminName" required />
                  <Field label="Admin e-mail" name="adminEmail" type="email" required />
                  <Field label="Tijdelijk wachtwoord" name="adminPassword" type="password" required />
                </div>
              </div>
              <Button>Tenant en admin maken</Button>
            </form>
          </Modal>
        }
      />

      <div className="grid gap-6">
        <TableShell>
          <table className="table-pro w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Klanten</th>
                <th className="px-3 py-2">Actieve gebruikers</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const isMainTenant = tenant.id === mainTenant?.id;
                const deviceCount = tenant.customers.reduce((count, customer) => count + customer.devices.length, 0);

                return (
                  <tr key={tenant.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        {tenant.name}
                        {isMainTenant ? <Badge>Main tenant</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{tenant.slug}</td>
                    <td className="px-3 py-2">
                      <Badge tone={tenant.active ? "success" : "danger"}>{tenant.active ? "Actief" : "Inactief"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div>{tenant.customers.length}</div>
                      <div className="text-xs text-muted-foreground">{deviceCount} FortiGates</div>
                    </td>
                    <td className="px-3 py-2">
                      {tenant.users.length
                        ? tenant.users.map((item) => item.email).join(", ")
                        : "Geen actieve gebruikers"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <form action={setTenantActive}>
                          <input type="hidden" name="id" value={tenant.id} />
                          <input type="hidden" name="active" value={tenant.active ? "false" : "true"} />
                          <Button>{tenant.active ? "Deactiveren" : "Activeren"}</Button>
                        </form>
                        {isMainTenant ? (
                          <Button variant="secondary" disabled>Main beschermd</Button>
                        ) : (
                          <Modal
                            title="Tenant verwijderen"
                            description="Deze actie verwijdert de tenant, gebruikers, klanten, FortiGates en opgeslagen configbestanden."
                            trigger={<Button variant="danger">Verwijderen</Button>}
                          >
                            <form action={deleteTenant} className="grid gap-4">
                              <input type="hidden" name="id" value={tenant.id} />
                              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                                <p className="font-semibold">Definitieve verwijdering</p>
                                <p className="mt-2">
                                  Hiermee verdwijnen {tenant.customers.length} klanten, {deviceCount} FortiGates,
                                  alle backuprecords en alle opgeslagen configuratiebestanden voor deze tenant.
                                </p>
                              </div>
                              <Field label={`Typ de slug "${tenant.slug}" ter bevestiging`} name="confirmSlug" required />
                              <Button variant="danger">Tenant definitief verwijderen</Button>
                            </form>
                          </Modal>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </div>
    </Shell>
  );
}
