import { createTenant } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const tenantCount = await prisma.tenant.count();
  return (
    <Shell>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold">Eerste inrichting</h1>
        {tenantCount > 0 ? (
          <p className="mt-3 text-muted-foreground">
            De setup is al uitgevoerd. Beheer tenants en instellingen via het portaal.
          </p>
        ) : (
          <form action={createTenant} className="mt-6 grid gap-4 rounded-md border border-border p-4">
            <Field label="Tenantnaam" name="name" required />
            <Field label="Slug" name="slug" required />
            <Field label="Admin naam" name="adminName" required />
            <Field label="Admin e-mail" name="adminEmail" type="email" required />
            <Field label="Admin wachtwoord" name="adminPassword" type="password" required />
            <input type="hidden" name="active" value="true" />
            <div>
              <Button>Tenant aanmaken</Button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}
