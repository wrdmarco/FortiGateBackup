import Link from "next/link";
import { createCustomer } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requireUser();
  const tenantWhere = isSuperAdmin(user) ? { active: true } : { id: user.tenantId ?? "", active: true };
  const customerWhere = isSuperAdmin(user) ? {} : { tenantId: user.tenantId ?? "" };
  const [tenants, customers] = await Promise.all([
    prisma.tenant.findMany({ where: tenantWhere, orderBy: { name: "asc" } }),
    prisma.customer.findMany({
      where: customerWhere,
      include: { tenant: true, devices: true },
      orderBy: { name: "asc" }
    })
  ]);

  return (
    <Shell>
      <h1 className="text-3xl font-semibold">Klanten</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <form action={createCustomer} className="grid gap-4 rounded-md border border-border p-4">
          <h2 className="text-lg font-semibold">Klant toevoegen</h2>
          {isSuperAdmin(user) ? (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Tenant</span>
              <select className="rounded-md border border-border px-3 py-2" name="tenantId" required>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="tenantId" value={user.tenantId ?? ""} />
          )}
          <Field label="Naam" name="name" required />
          <Field label="Contactpersoon" name="contact" />
          <Field label="E-mail" name="email" type="email" />
          <Field label="Telefoon" name="phone" />
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Notities</span>
            <textarea className="min-h-24 rounded-md border border-border px-3 py-2" name="notes" />
          </label>
          <Button>Opslaan</Button>
        </form>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2">Klant</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">FortiGates</th>
                <th className="px-3 py-2">Actie</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{customer.name}</td>
                  <td className="px-3 py-2">{customer.tenant.name}</td>
                  <td className="px-3 py-2">{customer.email ?? customer.contact ?? "-"}</td>
                  <td className="px-3 py-2">{customer.devices.length}</td>
                  <td className="px-3 py-2">
                    <Link
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                      href={`/customers/${customer.id}`}
                    >
                      Beheren
                    </Link>
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
