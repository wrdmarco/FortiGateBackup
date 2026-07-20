import { deleteTenantUser, resetTenantUserPassword, setTenantUserActive } from "@/app/actions";
import { Modal } from "@/components/modal";
import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { TenantUserCreateForm } from "@/components/tenant-user-create-form";
import { TenantUserEditForm } from "@/components/tenant-user-edit-form";
import { ActionLink, Badge, Button, PageHeader, Shell, TableShell } from "@/components/ui";
import { requireContextPermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureTenantRbac, hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function UsersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireContextPermission({
    global: "platform.users.read",
    tenant: "tenant.users.read"
  });
  const queryParams = await searchParams;
  const query = firstQueryValue(queryParams.q);
  const requestedPage = parsePageParam(queryParams.page);
  const tenantId = tenantFilter(currentUser) ?? "";
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, name: true } });
  const isGlobalContext = await isGlobalTenantId(tenant.id);
  await ensureTenantRbac(tenant.id);
  const userWhere = {
    tenantId: tenant.id,
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } }
          ]
        }
      : {})
  };
  const [totalUsers, activeUsers, inactiveUsers, roles, canCreate, canUpdate, canDelete, timeZone] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.user.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.user.count({ where: { tenantId: tenant.id, active: false } }),
    prisma.accessRole.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ system: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, system: true }
    }),
    hasPermission(currentUser, isGlobalContext ? "platform.users.create" : "tenant.users.create"),
    hasPermission(currentUser, isGlobalContext ? "platform.users.update" : "tenant.users.update"),
    hasPermission(currentUser, isGlobalContext ? "platform.users.delete" : "tenant.users.delete"),
    getTenantTimeZone(tenant.id)
  ]);
  const page = normalizePage(requestedPage, totalUsers, PAGE_SIZE);
  const users = await prisma.user.findMany({
    where: userWhere,
    orderBy: [{ active: "desc" }, { email: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      accessRoles: {
        include: { role: true }
      }
    }
  });

  return (
    <Shell>
      <PageHeader
        title="Gebruikers"
        description={`Beheer gebruikers, toegang en rollen voor ${tenant.name}.`}
        actions={
          canCreate ? (
            <Modal
              title="Gebruiker toevoegen"
              description="Maak een gebruiker aan en koppel direct een RBAC-rol binnen deze tenant."
              trigger={<Button>Gebruiker toevoegen</Button>}
            >
              <TenantUserCreateForm tenantId={tenant.id} roles={roles} />
            </Modal>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Metric label="Actief" value={activeUsers} />
        <Metric label="Inactief" value={inactiveUsers} />
        <Metric label="Rollen" value={roles.length} />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="grid min-w-64 flex-1 gap-1 text-sm">
          <span className="font-medium">Gebruikers zoeken</span>
          <input
            className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            defaultValue={query}
            name="q"
            placeholder="Naam of e-mailadres"
          />
        </label>
        <Button variant="secondary">Zoeken</Button>
        {query ? <ActionLink href="/users">Filter wissen</ActionLink> : null}
      </form>

      <TableShell>
        <table className="table-pro w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Gebruiker</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Login</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aangemaakt</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const assignedRoles = user.accessRoles.map((assignment) => assignment.role);
              const primaryRole = assignedRoles[0] ?? null;
              return (
                <tr key={user.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{user.name ?? user.email}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {assignedRoles.length ? assignedRoles.map((role) => <Badge key={role.id}>{role.name}</Badge>) : <Badge>{user.role}</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={user.mustChangePassword ? "warning" : "success"}>
                      {user.mustChangePassword ? "Wachtwoord wijzigen" : user.provider}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={user.active ? "success" : "danger"}>{user.active ? "Actief" : "Inactief"}</Badge>
                  </td>
                  <td className="px-3 py-2">{formatDateTime(user.createdAt, timeZone)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {canUpdate ? (
                        <Modal
                          title={`Gebruiker bewerken - ${user.email}`}
                          description="Wijzig profielgegevens en de RBAC-rol van deze gebruiker."
                          trigger={<Button variant="secondary">Bewerken</Button>}
                        >
                          <TenantUserEditForm
                            roles={roles}
                            user={{
                              id: user.id,
                              name: user.name,
                              email: user.email,
                              roleId: primaryRole?.id ?? roles[0]?.id ?? ""
                            }}
                          />
                        </Modal>
                      ) : null}
                      {canUpdate && user.id !== currentUser.id && user.provider !== "ENTRA" ? (
                        <Modal
                          title={`Wachtwoord resetten - ${user.email}`}
                          description="Genereer een tijdelijk wachtwoord en dwing een wijziging af bij de volgende login."
                          trigger={<Button variant="secondary" disabled={!user.active}>Wachtwoord resetten</Button>}
                        >
                          <form action={resetTenantUserPassword} className="grid gap-4">
                            <input type="hidden" name="id" value={user.id} />
                            <p className="rounded-md border border-border bg-surface-soft p-4 text-sm text-muted-foreground">
                              De gebruiker ontvangt een nieuw tijdelijk wachtwoord via de geconfigureerde mailprovider.
                            </p>
                            <Button disabled={!user.active}>Nieuw tijdelijk wachtwoord versturen</Button>
                          </form>
                        </Modal>
                      ) : null}
                      {canUpdate && user.id !== currentUser.id ? (
                        user.active ? (
                          <Modal
                            title={`Gebruiker deactiveren - ${user.email}`}
                            description="De gebruiker kan niet meer inloggen totdat het account opnieuw wordt geactiveerd."
                            trigger={<Button variant="secondary">Deactiveren</Button>}
                          >
                            <form action={setTenantUserActive} className="grid gap-4">
                              <input type="hidden" name="id" value={user.id} />
                              <input type="hidden" name="active" value="false" />
                              <Button variant="danger">Gebruiker deactiveren</Button>
                            </form>
                          </Modal>
                        ) : (
                          <form action={setTenantUserActive}>
                            <input type="hidden" name="id" value={user.id} />
                            <input type="hidden" name="active" value="true" />
                            <Button variant="secondary">Activeren</Button>
                          </form>
                        )
                      ) : null}
                      {canDelete && user.id !== currentUser.id ? (
                        <Modal
                          title={`Gebruiker verwijderen - ${user.email}`}
                          description="Verwijder het account. Bestaande auditregels blijven aan de oorspronkelijke actor gekoppeld."
                          trigger={<Button variant="danger">Verwijderen</Button>}
                        >
                          <form action={deleteTenantUser} className="grid gap-4">
                            <input type="hidden" name="id" value={user.id} />
                            <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                              Deze gebruiker verliest direct alle toegang tot {tenant.name}.
                            </p>
                            <Button variant="danger">Gebruiker definitief verwijderen</Button>
                          </form>
                        </Modal>
                      ) : null}
                      {user.id === currentUser.id ? <Button variant="secondary" disabled>Eigen account</Button> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!users.length ? (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>Geen gebruikers gevonden.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableShell>
      <ServerPagination
        itemLabel="gebruikers"
        page={page}
        pageSize={PAGE_SIZE}
        path="/users"
        query={{ q: query }}
        totalItems={totalUsers}
      />
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </section>
  );
}
