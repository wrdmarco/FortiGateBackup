import { deleteTenant, setTenantActive } from "@/app/actions";
import { DeleteConfirmInput } from "@/components/delete-confirm-input";
import { Modal } from "@/components/modal";
import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { TenantCreateForm } from "@/components/tenant-create-form";
import { ActionLink, Badge, Button, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { mainTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function TenantsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requirePermission("platform.tenants.read");
  const queryParams = await searchParams;
  const query = firstQueryValue(queryParams.q);
  const requestedPage = parsePageParam(queryParams.page);
  const tenantWhere = query ? { name: { contains: query } } : {};
  const [totalTenants, mainTenant, canCreate, canUpdate, canDelete, canExport, canRestore, canReadUsers] = await Promise.all([
    prisma.tenant.count({ where: tenantWhere }),
    mainTenantId(),
    hasPermission(currentUser, "platform.tenants.create"),
    hasPermission(currentUser, "platform.tenants.update"),
    hasPermission(currentUser, "platform.tenants.delete"),
    hasPermission(currentUser, "platform.tenants.export"),
    hasPermission(currentUser, "platform.tenants.restore"),
    hasPermission(currentUser, "platform.users.read")
  ]);
  const page = normalizePage(requestedPage, totalTenants, PAGE_SIZE);
  const tenants = await prisma.tenant.findMany({
    where: tenantWhere,
    select: {
      id: true,
      name: true,
      active: true,
      _count: {
        select: { users: { where: { active: true } } }
      }
    },
    orderBy: { name: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE
  });

  return (
    <Shell>
      <PageHeader
        title="Tenants"
        description="Alleen platformbeheerders kunnen tenants aanmaken. Tenantadmins beheren daarna uitsluitend hun eigen klanten, FortiGates, backups en instellingen."
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreate ? <Modal
              title="Tenant aanmaken"
              description="Maak een tenant inclusief eerste tenantadmin."
              trigger={<Button>Tenant aanmaken</Button>}
            >
              <TenantCreateForm />
            </Modal> : null}
            {canRestore ? (
              <Modal
                title="Tenant herstellen uit zip"
                description="Upload een tenant backup zip om een ontbrekende tenant opnieuw aan te maken."
                trigger={<Button variant="secondary">Tenant restore zip</Button>}
              >
                <form action="/api/tenants/archive" method="post" encType="multipart/form-data" className="grid gap-4">
                  <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <p className="text-base font-semibold">Restore maakt de tenant aan als deze ontbreekt</p>
                    <p>
                      Bestaat de tenant-id al, dan wordt dezelfde tenant hersteld. Bestaat deze niet, dan wordt de tenant uit de zip aangemaakt.
                    </p>
                    <p>De Global tenant kan hiermee niet worden hersteld.</p>
                  </div>
                  <Field label="Tenant backup zip" name="archive" type="file" required />
                  <Button variant="danger">Zip uploaden en tenant herstellen</Button>
                </form>
              </Modal>
            ) : null}
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="grid min-w-64 flex-1 gap-1 text-sm">
          <span className="font-medium">Tenants zoeken</span>
          <input
            className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            defaultValue={query}
            name="q"
            placeholder="Tenantnaam"
          />
        </label>
        <Button variant="secondary">Zoeken</Button>
        {query ? <ActionLink href="/tenants">Filter wissen</ActionLink> : null}
      </form>

      <div className="grid gap-6">
        <TableShell>
          <table className="table-pro w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actieve gebruikers</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const isMainTenant = tenant.id === mainTenant;

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
                    <td className="px-3 py-2">{tenant._count.users}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {canReadUsers && tenant.id === currentUser.activeTenantId ? (
                          <ActionLink href="/users" variant="secondary">Gebruikers</ActionLink>
                        ) : null}
                        {!isMainTenant && canUpdate ? (
                          <form action={setTenantActive}>
                            <input type="hidden" name="id" value={tenant.id} />
                            <input type="hidden" name="active" value={tenant.active ? "false" : "true"} />
                            <Button>{tenant.active ? "Deactiveren" : "Activeren"}</Button>
                          </form>
                        ) : null}
                        {!isMainTenant && canExport ? (
                          <ActionLink href={`/api/tenants/${tenant.id}/archive`} variant="secondary">Backup zip</ActionLink>
                        ) : null}
                        {!isMainTenant && canRestore ? (
                            <Modal
                              title={`Tenant restore - ${tenant.name}`}
                              description="Upload een tenant backup zip. Dit vervangt klant-, FortiGate-, backup- en tenantinstellingen voor deze tenant."
                              trigger={<Button variant="secondary">Restore</Button>}
                            >
                              <form action={`/api/tenants/${tenant.id}/archive`} method="post" encType="multipart/form-data" className="grid gap-4">
                                <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                                  <p className="text-base font-semibold">Let op: restore vervangt operationele tenantdata</p>
                                  <p>
                                    Klanten, FortiGates, backuprecords, configuratiebestanden en tenantinstellingen worden vervangen door de inhoud van de zip.
                                    Gebruikers en sessies blijven intact.
                                  </p>
                                  <p>De zip moet bij exact deze tenant horen.</p>
                                </div>
                                <Field label="Tenant backup zip" name="archive" type="file" required />
                                <Button variant="danger">Zip uploaden en restore starten</Button>
                              </form>
                            </Modal>
                        ) : null}
                        {!isMainTenant && canDelete ? (
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
                                  Hiermee verdwijnen alle gebruikers, klanten, FortiGates, backuprecords en opgeslagen configuratiebestanden voor deze tenant.
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
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!tenants.length ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={4}>Geen tenants gevonden.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
        <ServerPagination
          itemLabel="tenants"
          page={page}
          pageSize={PAGE_SIZE}
          path="/tenants"
          query={{ q: query }}
          totalItems={totalTenants}
        />
      </div>
    </Shell>
  );
}
