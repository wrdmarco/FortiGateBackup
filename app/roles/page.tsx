import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureTenantRbac, permissions } from "@/lib/rbac";
import { PageHeader, Panel, Shell } from "@/components/ui";

export const dynamic = "force-dynamic";

type RoleWithDetails = Prisma.AccessRoleGetPayload<{
  include: {
    permissions: { include: { permission: true } };
    _count: { select: { users: true } };
  };
}>;

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
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);
  const groupedPermissions = permissions.reduce<Record<string, typeof permissions[number][]>>((groups, permission) => {
    groups[permission.category] = [...(groups[permission.category] ?? []), permission];
    return groups;
  }, {});

  return (
    <Shell>
      <PageHeader
        title="Rollen"
        description="Tenant-scoped RBAC rollen en permissies. Elke tenant heeft een eigen rollenset."
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title={selectedTenant ? `Rollen voor ${selectedTenant.name}` : "Rollen"}>
          {rolesError ? (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {rolesError}
            </div>
          ) : null}
          <div className="grid gap-4">
            {roles.map((role) => (
              <section key={role.id} className="rounded-md border border-border bg-surface-soft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{role.name}</h2>
                    {role.description ? <p className="mt-1 text-sm text-muted-foreground">{role.description}</p> : null}
                  </div>
                  <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {role._count.users} gebruiker{role._count.users === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {role.permissions
                    .map(({ permission }) => permission)
                    .sort((a, b) => a.key.localeCompare(b.key))
                    .map((permission) => (
                      <span key={permission.id} className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs">
                        {permission.key}
                      </span>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </Panel>

        <Panel title="Permission catalogus">
          <div className="grid gap-4">
            {Object.entries(groupedPermissions).map(([category, items]) => (
              <section key={category}>
                <h2 className="text-sm font-semibold">{category}</h2>
                <div className="mt-2 grid gap-2">
                  {items.map((permission) => (
                    <div key={permission.key} className="rounded-md border border-border bg-surface-soft p-3">
                      <p className="font-mono text-xs">{permission.key}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
