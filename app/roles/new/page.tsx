import { RoleCreateForm } from "@/components/role-create-form";
import { ActionLink, PageHeader, Panel, Shell } from "@/components/ui";
import { requireContextPermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rolePermissionGroups } from "@/lib/role-permission-groups";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const user = await requireContextPermission({
    global: "platform.roles.create",
    tenant: "tenant.roles.create"
  });
  const tenantId = tenantFilter(user);
  if (!tenantId) throw new Error("Selecteer eerst een tenant.");
  const [tenant, isGlobalContext] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    isGlobalTenantId(tenantId)
  ]);

  return (
    <Shell>
      <PageHeader
        title="Custom rol toevoegen"
        description={`Stel een duidelijke rol samen voor ${tenant?.name ?? "de geselecteerde tenant"}.`}
        actions={<ActionLink href="/roles" variant="secondary">Terug naar rollen</ActionLink>}
      />
      <div className="mx-auto w-full max-w-6xl">
        <Panel title="Rolgegevens en rechten" description="Geef de rol een herkenbare naam en selecteer alleen de benodigde permissies.">
          <RoleCreateForm tenantId={tenantId} groupedPermissions={rolePermissionGroups(isGlobalContext)} />
        </Panel>
      </div>
    </Shell>
  );
}
