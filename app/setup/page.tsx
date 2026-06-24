import { redirect } from "next/navigation";
import { createTenant } from "@/app/actions";
import { Button, Field, PageHeader, Panel, Shell } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const tenantCount = await prisma.tenant.count();
  if (tenantCount > 0) redirect("/");

  return (
    <Shell>
      <div className="max-w-2xl">
        <PageHeader
          title="Eerste inrichting"
          description="Maak de eerste tenant en super-admin aan om het portaal te activeren."
        />
        <Panel>
          <form action={createTenant} className="grid gap-4">
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
        </Panel>
      </div>
    </Shell>
  );
}