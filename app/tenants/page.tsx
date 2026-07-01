import { deleteTenant, deleteTenantUser, setTenantActive } from "@/app/actions";
import { DeleteConfirmInput } from "@/components/delete-confirm-input";
import { Modal } from "@/components/modal";
import { TenantCreateForm } from "@/components/tenant-create-form";
import { TenantUserCreateForm } from "@/components/tenant-user-create-form";
import { Badge, Button, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { mainTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const currentUser = await requireSuperAdmin();
  const [tenants, mainTenant] = await Promise.all([
    prisma.tenant.findMany({
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
          orderBy: { email: "asc" }
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
    mainTenantId()
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
            <TenantCreateForm />
          </Modal>
        }
      />

      <div className="grid gap-6">
        <TableShell>
          <table className="table-pro w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Klanten</th>
                <th className="px-3 py-2">Actieve gebruikers</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const isMainTenant = tenant.id === mainTenant;
                const deviceCount = tenant.customers.reduce((count, customer) => count + customer.devices.length, 0);

                return (
                  <tr key={tenant.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        {tenant.name}
                        {isMainTenant ? <Badge>Global</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={tenant.active ? "success" : "danger"}>{tenant.active ? "Actief" : "Inactief"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div>{tenant.customers.length}</div>
                      <div className="text-xs text-muted-foreground">{deviceCount} FortiGates</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid gap-1">
                        <div>{tenant.users.filter((item) => item.active).length} actief</div>
                        <div className="max-w-[280px] truncate text-xs text-muted-foreground">
                          {tenant.users.length
                            ? tenant.users.map((item) => item.email).join(", ")
                            : "Geen gebruikers"}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Modal
                          title={`Gebruikers beheren - ${tenant.name}`}
                          description="Voeg tenantgebruikers toe, kies hun rol en verwijder accounts die geen toegang meer nodig hebben."
                          trigger={<Button variant="secondary">Gebruikers</Button>}
                        >
                          <div className="grid gap-6">
                            <section>
                              <h3 className="font-semibold">Nieuwe gebruiker</h3>
                              <TenantUserCreateForm tenantId={tenant.id} />
                            </section>

                            <section className="border-t border-border pt-5">
                              <h3 className="font-semibold">Bestaande gebruikers</h3>
                              <div className="mt-3 overflow-hidden rounded-md border border-border">
                                <table className="w-full text-left text-sm">
                                  <thead className="bg-surface-soft text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2">Gebruiker</th>
                                      <th className="px-3 py-2">Rol</th>
                                      <th className="px-3 py-2">Status</th>
                                      <th className="px-3 py-2">Actie</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tenant.users.map((tenantUser) => (
                                      <tr key={tenantUser.id} className="border-t border-border">
                                        <td className="px-3 py-2">
                                          <div className="font-medium">{tenantUser.name ?? tenantUser.email}</div>
                                          <div className="text-xs text-muted-foreground">{tenantUser.email}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <Badge tone={tenantUser.role === "ADMIN" || tenantUser.role === "SUPER_ADMIN" ? "warning" : "neutral"}>
                                            {tenantUser.role}
                                          </Badge>
                                        </td>
                                        <td className="px-3 py-2">
                                          <Badge tone={tenantUser.active ? "success" : "danger"}>
                                            {tenantUser.active ? "Actief" : "Inactief"}
                                          </Badge>
                                        </td>
                                        <td className="px-3 py-2">
                                          {tenantUser.id === currentUser.id ? (
                                            <Button variant="secondary" disabled>Eigen account</Button>
                                          ) : (
                                            <form action={deleteTenantUser}>
                                              <input type="hidden" name="id" value={tenantUser.id} />
                                              <Button variant="danger">Verwijderen</Button>
                                            </form>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          </div>
                        </Modal>
                        {isMainTenant ? (
                          <Button variant="secondary" disabled>Global actief</Button>
                        ) : (
                          <form action={setTenantActive}>
                            <input type="hidden" name="id" value={tenant.id} />
                            <input type="hidden" name="active" value={tenant.active ? "false" : "true"} />
                            <Button>{tenant.active ? "Deactiveren" : "Activeren"}</Button>
                          </form>
                        )}
                        {isMainTenant ? (
                          <Button variant="secondary" disabled>Global beschermd</Button>
                        ) : (
                          <Modal
                            title="Tenant verwijderen"
                            description="Deze actie verwijdert de tenant, gebruikers, klanten, FortiGates en opgeslagen configbestanden."
                            trigger={<Button variant="danger">Verwijderen</Button>}
                          >
                            <form action={deleteTenant} className="grid gap-4">
                              <input type="hidden" name="id" value={tenant.id} />
                              <div className="grid gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                                <p className="text-base font-semibold">Let op: dit verwijdert de volledige tenant definitief</p>
                                <p>
                                  Hiermee verdwijnen {tenant.customers.length} klanten, {deviceCount} FortiGates,
                                  alle gebruikers, alle backuprecords en alle opgeslagen configuratiebestanden voor deze tenant.
                                </p>
                                <p>
                                  Dit is de enige manier om ook de laatste gebruiker van een tenant te verwijderen. Losse user-delete
                                  blokkeert bewust zodra er maar een gebruiker over is.
                                </p>
                                <p className="font-semibold">Deze actie kan niet ongedaan gemaakt worden.</p>
                              </div>
                              <Field label={`Typ de tenantnaam "${tenant.name}" ter bevestiging`} name="confirmName" required />
                              <DeleteConfirmInput />
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
