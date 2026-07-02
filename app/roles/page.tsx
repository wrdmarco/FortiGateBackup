import { Fragment } from "react";
import type { Prisma } from "@prisma/client";
import { deleteAccessRole } from "@/app/actions";
import { Modal } from "@/components/modal";
import { RoleCreateForm } from "@/components/role-create-form";
import { RoleEditForm } from "@/components/role-edit-form";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureTenantRbac, permissions } from "@/lib/rbac";
import { mainTenantId } from "@/lib/tenant-main";
import { Button, PageHeader, Panel, Shell } from "@/components/ui";

export const dynamic = "force-dynamic";

type RoleWithDetails = Prisma.AccessRoleGetPayload<{
  include: {
    permissions: { include: { permission: true } };
    _count: { select: { users: true } };
  };
}>;
type PermissionForDisplay = {
  key: string;
  category: string;
  description: string;
};

export default async function RolesPage() {
  const user = await requireTenantUser();
  const canManagePlatform = isSuperAdmin(user);
  const globalTenantId = canManagePlatform ? await mainTenantId() : null;
  const selectedTenantId = canManagePlatform ? user.activeTenantId ?? globalTenantId : user.tenantId;

  let roles: RoleWithDetails[] = [];
  let rolesError: string | null = null;

  if (selectedTenantId) {
    try {
      await ensureTenantRbac(selectedTenantId);
      roles = await prisma.accessRole.findMany({
        where: { tenantId: selectedTenantId },
        orderBy: [{ system: "desc" }, { name: "asc" }],
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { users: true } }
        }
      });
    } catch (error) {
      rolesError =
        error instanceof Error
          ? error.message
          : "De rollen konden niet worden geladen. Controleer of de RBAC migratie is uitgevoerd.";
    }
  }
  const selectedTenant = selectedTenantId
    ? await prisma.tenant.findUnique({ where: { id: selectedTenantId }, select: { id: true, name: true } })
    : null;
  const showPlatformPermissions = selectedTenantId === globalTenantId;
  const visiblePermissions: PermissionForDisplay[] = permissions
    .filter((permission) => showPlatformPermissions || !permission.key.startsWith("platform."))
    .map((permission) => ({ key: permission.key, category: permission.category, description: permission.description }));
  const visiblePermissionKeys = new Set(visiblePermissions.map((permission) => permission.key));
  const groupedPermissions = visiblePermissions.reduce<Record<string, PermissionForDisplay[]>>((groups, permission) => {
    groups[permission.category] = [...(groups[permission.category] ?? []), permission];
    return groups;
  }, {});
  const groupedPermissionEntries = Object.entries(groupedPermissions);
  const matrixRoles = [...roles].sort((left, right) => {
    const leftCount = left.permissions.filter(({ permission }) => visiblePermissionKeys.has(permission.key)).length;
    const rightCount = right.permissions.filter(({ permission }) => visiblePermissionKeys.has(permission.key)).length;
    return leftCount - rightCount || left.name.localeCompare(right.name);
  });
  const rolePermissionKeys = new Map(
    roles.map((role) => [role.id, new Set(role.permissions.map(({ permission }) => permission.key))])
  );

  return (
    <Shell>
      <PageHeader
        title="Rollen"
        description="Tenant-scoped RBAC rollen met een centrale permission catalogus voor tenant- en platformrechten."
        actions={
          selectedTenantId && !rolesError ? (
            <Modal
              title="Custom rol aanmaken"
              description={selectedTenant ? `Maak een tenantrol voor ${selectedTenant.name} en kies exact welke rechten erbij horen.` : "Maak een tenantrol en kies exact welke rechten erbij horen."}
              trigger={<Button>Custom rol toevoegen</Button>}
            >
              <RoleCreateForm tenantId={selectedTenantId} groupedPermissions={groupedPermissionEntries} />
            </Modal>
          ) : null
        }
      />

      <div className="grid gap-6">
        <Panel
          title={selectedTenant ? `Rollenmatrix voor ${selectedTenant.name}` : "Rollenmatrix"}
          description="Vergelijk permissies per rol."
        >
          {rolesError ? (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {rolesError}
            </div>
          ) : null}
          {roles.length ? (
            <div className="overflow-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-[940px] border-collapse text-left text-sm">
                <thead className="bg-surface-soft">
                  <tr>
                    <th className="sticky left-0 z-20 w-[340px] border-b border-r border-border bg-surface-soft px-4 py-3">
                      Permission
                    </th>
                    {matrixRoles.map((role) => (
                      <th key={role.id} className="min-w-[140px] border-b border-border px-3 py-3 text-center">
                        <span className="font-semibold text-foreground">{role.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedPermissionEntries.map(([category, items]) => (
                    <Fragment key={category}>
                      <tr key={`${category}-group`}>
                        <th
                          colSpan={matrixRoles.length + 1}
                          className="border-b border-border bg-muted px-4 py-2 text-xs font-semibold uppercase text-muted-foreground"
                        >
                          {category}
                        </th>
                      </tr>
                      {items.map((permission) => (
                        <tr key={permission.key} className="border-b border-border last:border-b-0">
                          <th className="sticky left-0 z-10 border-r border-border bg-surface px-4 py-2.5 align-middle">
                            <span className="block text-sm font-medium text-foreground">{permission.description}</span>
                            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{permission.key}</span>
                          </th>
                          {matrixRoles.map((role) => {
                            const allowed = rolePermissionKeys.get(role.id)?.has(permission.key) ?? false;
                            return (
                              <td key={`${role.id}-${permission.key}`} className="px-3 py-3 text-center align-middle">
                                <input
                                  aria-label={`${role.name}: ${permission.key}`}
                                  checked={allowed}
                                  className="h-4 w-4 rounded border-border accent-primary disabled:cursor-default disabled:opacity-100"
                                  disabled
                                  readOnly
                                  type="checkbox"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !rolesError ? (
            <div className="rounded-md border border-border bg-surface-soft p-4 text-sm text-muted-foreground">
              Geen rollen gevonden voor deze tenant.
            </div>
          ) : null}
          {roles.some((role) => !role.system) ? (
            <div className="mt-4 grid gap-2 rounded-md border border-border bg-surface-soft p-3">
              <h3 className="text-sm font-semibold">Custom rollen beheren</h3>
              <div className="flex flex-wrap gap-2">
                {roles
                  .filter((role) => !role.system)
                  .map((role) => (
                    <div key={role.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                      <span className="font-medium">{role.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {role._count.users} gebruiker{role._count.users === 1 ? "" : "s"}
                      </span>
                      <Modal
                        title={`Rol ${role.name} aanpassen`}
                        description="Wijzig de naam, omschrijving en permissies van deze custom rol."
                        trigger={<Button variant="secondary">Aanpassen</Button>}
                      >
                        <RoleEditForm
                          groupedPermissions={groupedPermissionEntries}
                          role={{
                            id: role.id,
                            name: role.name,
                            description: role.description,
                            permissionKeys: role.permissions.map(({ permission }) => permission.key)
                          }}
                        />
                      </Modal>
                      {role._count.users === 0 ? (
                        <form action={deleteAccessRole}>
                          <input type="hidden" name="roleId" value={role.id} />
                          <Button variant="danger">Verwijderen</Button>
                        </form>
                      ) : (
                        <Button variant="secondary" disabled>
                          In gebruik
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </Shell>
  );
}
