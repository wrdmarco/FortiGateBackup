import { notFound } from "next/navigation";
import { RoleEditForm } from "@/components/role-edit-form";
import { ActionLink, PageHeader, Panel, Shell } from "@/components/ui";
import { requireContextPermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rolePermissionGroups } from "@/lib/role-permission-groups";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireContextPermission({
    global: "platform.roles.update",
    tenant: "tenant.roles.update"
  });
  const tenantId = tenantFilter(user);
  if (!tenantId) notFound();
  const { id } = await params;
  const [role, isGlobalContext] = await Promise.all([
    prisma.accessRole.findFirst({
      where: { id, tenantId, system: false },
      include: { permissions: { include: { permission: true } } }
    }),
    isGlobalTenantId(tenantId)
  ]);
  if (!role) notFound();

  return (
    <Shell>
      <PageHeader
        title={`${role.name} bewerken`}
        description="Werk de rolgegevens en permissies in één overzichtelijke werkruimte bij."
        actions={<ActionLink href="/roles" variant="secondary">Terug naar rollen</ActionLink>}
      />
      <div className="mx-auto w-full max-w-6xl">
        <Panel title="Rolgegevens en rechten" description="Wijzigingen gelden direct voor alle gebruikers met deze rol.">
          <RoleEditForm
            groupedPermissions={rolePermissionGroups(isGlobalContext)}
            role={{
              id: role.id,
              name: role.name,
              description: role.description,
              permissionKeys: role.permissions.map(({ permission }) => permission.key)
            }}
          />
        </Panel>
      </div>
    </Shell>
  );
}
