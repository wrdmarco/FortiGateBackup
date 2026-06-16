import { createManagedTenant, setTenantActive } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  await requireSuperAdmin();
  const tenants = await prisma.tenant.findMany({
    include: {
      users: {
        where: { active: true },
        select: { id: true, name: true, email: true, role: true }
      },
      customers: { select: { id: true } }
    },
    orderBy: { name: "asc" }
  });

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Tenants</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Alleen platformbeheerders kunnen tenants aanmaken. Tenantadmins beheren daarna uitsluitend
          hun eigen klanten, FortiGates, backups en instellingen.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form action={createManagedTenant} className="grid gap-4 rounded-md border border-border p-4">
          <h2 className="text-lg font-semibold">Tenant aanmaken</h2>
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

        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-muted">
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
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{tenant.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{tenant.slug}</td>
                  <td className="px-3 py-2">{tenant.active ? "Actief" : "Inactief"}</td>
                  <td className="px-3 py-2">{tenant.customers.length}</td>
                  <td className="px-3 py-2">
                    {tenant.users.length
                      ? tenant.users.map((item) => item.email).join(", ")
                      : "Geen actieve gebruikers"}
                  </td>
                  <td className="px-3 py-2">
                    <form action={setTenantActive}>
                      <input type="hidden" name="id" value={tenant.id} />
                      <input type="hidden" name="active" value={tenant.active ? "false" : "true"} />
                      <Button>{tenant.active ? "Deactiveren" : "Activeren"}</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
