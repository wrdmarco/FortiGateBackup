import { saveSettings } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const tenants = isSuperAdmin(user)
    ? await prisma.tenant.findMany({ orderBy: { name: "asc" } })
    : [];
  return (
    <Shell>
      <h1 className="text-3xl font-semibold">Instellingen</h1>
      <form action={saveSettings} className="mt-6 grid max-w-3xl gap-6 rounded-md border border-border p-4">
        {isSuperAdmin(user) ? (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Tenant</span>
            <select className="rounded-md border border-border px-3 py-2" name="tenantId">
              <option value="">Globaal</option>
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
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Mail</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Provider</span>
            <select className="rounded-md border border-border px-3 py-2" name="mail.provider">
              <option value="SMTP">SMTP</option>
              <option value="MICROSOFT_GRAPH">Microsoft Graph</option>
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="SMTP host" name="smtp.host" />
            <Field label="SMTP poort" name="smtp.port" type="number" />
            <Field label="SMTP gebruiker" name="smtp.user" />
            <Field label="SMTP wachtwoord" name="smtp.password" type="password" />
            <Field label="SMTP afzender" name="smtp.from" type="email" />
            <Field label="Graph afzender" name="graph.from" type="email" />
            <Field label="Graph access token" name="graph.accessToken" type="password" />
          </div>
        </section>
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Microsoft Entra ID</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tenant ID" name="entra.tenantId" />
            <Field label="Client ID" name="entra.clientId" />
            <Field label="Client secret" name="entra.clientSecret" type="password" />
          </div>
        </section>
        <div>
          <Button>Instellingen opslaan</Button>
        </div>
      </form>
    </Shell>
  );
}
