import { notFound } from "next/navigation";
import { deleteTenantUser, resetTenantUserPassword, setTenantUserActive } from "@/app/actions";
import { Modal } from "@/components/modal";
import { TenantUserCreateForm } from "@/components/tenant-user-create-form";
import { TenantUserEditForm } from "@/components/tenant-user-edit-form";
import { Badge, Button, PageHeader, Shell, TableShell } from "@/components/ui";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureTenantRbac, hasPermission } from "@/lib/rbac";
import { isGlobalTenantId, mainTenantId } from "@/lib/tenant-main";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const currentUser = await requireTenantUser();
  const globalTenantId = await mainTenantId();
  const tenantId = isSuperAdmin(currentUser) ? currentUser.activeTenantId ?? globalTenantId ?? "" : currentUser.tenantId ?? "";
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, name: true } });
  const isGlobalContext = await isGlobalTenantId(tenant.id);
  const readPermission = isSuperAdmin(currentUser) && isGlobalContext ? "platform.users.read" : "tenant.users.read";
  if (!(await hasPermission(currentUser, readPermission))) notFound();
  await ensureTenantRbac(tenant.id);
  const [users, roles, canCreate, canUpdate, canDelete, timeZone] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ active: "desc" }, { email: "asc" }],
      include: {
        accessRoles: {
          include: {
            role: true
          }
        }
      }
    }),
    prisma.accessRole.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ system: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, system: true }
    }),
    hasPermission(currentUser, isSuperAdmin(currentUser) && isGlobalContext ? "platform.users.create" : "tenant.users.create"),
    hasPermission(currentUser, isSuperAdmin(currentUser) && isGlobalContext ? "platform.users.update" : "tenant.users.update"),
    hasPermission(currentUser, isSuperAdmin(currentUser) && isGlobalContext ? "platform.users.delete" : "tenant.users.delete"),
    getTenantTimeZone(tenant.id)
  ]);

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
        <Metric label="Actief" value={users.filter((user) => user.active).length} />
        <Metric label="Inactief" value={users.filter((user) => !user.active).length} />
        <Metric label="Rollen" value={roles.length} />
      </div>

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
                      {canUpdate && user.id !== currentUser.id ? (
                        <form action={resetTenantUserPassword}>
                          <input type="hidden" name="id" value={user.id} />
                          <Button variant="secondary" disabled={!user.active}>
                            Wachtwoord resetten
                          </Button>
                        </form>
                      ) : null}
                      {canUpdate && user.id !== currentUser.id ? (
                        <form action={setTenantUserActive}>
                          <input type="hidden" name="id" value={user.id} />
                          <input type="hidden" name="active" value={user.active ? "false" : "true"} />
                          <Button variant="secondary">{user.active ? "Deactiveren" : "Activeren"}</Button>
                        </form>
                      ) : null}
                      {canDelete && user.id !== currentUser.id ? (
                        <form action={deleteTenantUser}>
                          <input type="hidden" name="id" value={user.id} />
                          <Button variant="danger">Verwijderen</Button>
                        </form>
                      ) : null}
                      {user.id === currentUser.id ? <Button variant="secondary" disabled>Eigen account</Button> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
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
