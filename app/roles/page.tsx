import { Fragment } from "react";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { deleteAccessRole } from "@/app/actions";
import { Modal } from "@/components/modal";
import { RoleCreateForm } from "@/components/role-create-form";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureTenantRbac, permissions } from "@/lib/rbac";
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

export default async function RolesPage({
  searchParams
}: {
  searchParams?: Promise<{ tenantId?: string }>;
}) {
  const user = await requireTenantUser();
  const params = await searchParams;
  const tenants = isSuperAdmin(user)
    ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" } })
    : [];
  const selectedTenantId = isSuperAdmin(user)
    ? tenants.find((tenant) => tenant.id === params?.tenantId)?.id ?? tenants[0]?.id ?? null
    : user.tenantId;

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
    ? tenants.find((tenant) => tenant.id === selectedTenantId) ??
      (await prisma.tenant.findUnique({ where: { id: selectedTenantId }, select: { id: true, name: true } }))
    : null;
  const visiblePermissions: PermissionForDisplay[] = permissions
    .filter((permission) => isSuperAdmin(user) || !permission.key.startsWith("platform."))
    .map((permission) => ({ key: permission.key, category: permission.category, description: permission.description }));
  const groupedPermissions = visiblePermissions.reduce<Record<string, PermissionForDisplay[]>>((groups, permission) => {
    groups[permission.category] = [...(groups[permission.category] ?? []), permission];
    return groups;
  }, {});
  const groupedPermissionEntries = Object.entries(groupedPermissions);
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

      {tenants.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {tenants.map((tenant) => (
            <Link
              key={tenant.id}
              className={
                tenant.id === selectedTenantId
                  ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  : "rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              }
              href={`/roles?tenantId=${tenant.id}`}
            >
              {tenant.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6">
        <Panel
          title={selectedTenant ? `Rollenmatrix voor ${selectedTenant.name}` : "Rollenmatrix"}
          description="Vergelijk per permission welke rol toegang heeft. Rollen staan horizontaal, permissions verticaal gegroepeerd."
        >
          {rolesError ? (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {rolesError}
            </div>
          ) : null}
          {roles.length ? (
            <div className="overflow-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-surface-soft">
                  <tr>
                    <th className="sticky left-0 z-20 w-[340px] border-b border-r border-border bg-surface-soft px-4 py-3 align-top">
                      Permission
                    </th>
                    {roles.map((role) => (
                      <th key={role.id} className="min-w-[180px] border-b border-border px-3 py-3 align-top">
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{role.name}</span>
                            {role.system ? (
                              <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                Systeem
                              </span>
                            ) : null}
                          </div>
                          {role.description ? <p className="text-xs font-normal text-muted-foreground">{role.description}</p> : null}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-muted-foreground">
                              {role._count.users} gebruiker{role._count.users === 1 ? "" : "s"}
                            </span>
                            {!role.system && role._count.users === 0 ? (
                              <form action={deleteAccessRole}>
                                <input type="hidden" name="roleId" value={role.id} />
                                <Button variant="danger">Verwijderen</Button>
                              </form>
                            ) : !role.system ? (
                              <Button variant="secondary" disabled>
                                Heeft leden
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedPermissionEntries.map(([category, items]) => (
                    <Fragment key={category}>
                      <tr key={`${category}-group`}>
                        <th
                          colSpan={roles.length + 1}
                          className="border-b border-border bg-muted px-4 py-2 text-xs font-semibold uppercase text-muted-foreground"
                        >
                          {category}
                        </th>
                      </tr>
                      {items.map((permission) => (
                        <tr key={permission.key} className="border-b border-border last:border-b-0">
                          <th className="sticky left-0 z-10 border-r border-border bg-surface px-4 py-3 align-top">
                            <span className="block font-mono text-xs text-foreground">{permission.key}</span>
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">{permission.description}</span>
                          </th>
                          {roles.map((role) => {
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
        </Panel>
      </div>
    </Shell>
  );
}
