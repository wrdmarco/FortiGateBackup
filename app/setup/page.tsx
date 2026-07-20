import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createTenant } from "@/app/actions";
import { SetupTokenExchange } from "@/components/setup-token-exchange";
import { Button, Field, PageHeader, Panel, Shell } from "@/components/ui";
import { prisma } from "@/lib/db";
import { setupTokenCookieName, setupTokenIsValid } from "@/lib/setup-token";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const tenantCount = await prisma.tenant.count();
  if (tenantCount > 0) redirect("/");
  const token = (await cookies()).get(setupTokenCookieName)?.value ?? "";
  const tokenValid = await setupTokenIsValid(token);

  return (
    <Shell>
      <div className="max-w-2xl">
        <PageHeader
          title="Eerste inrichting"
          description="Maak de eerste tenant en super-admin aan om het portaal te activeren."
        />
        <Panel>
          {tokenValid ? (
            <form action={createTenant} className="grid gap-4">
              <Field label="Admin naam" name="adminName" required />
              <Field label="Admin e-mail" name="adminEmail" type="email" required />
              <Field label="Admin wachtwoord" name="adminPassword" type="password" minLength={12} required />
              <div>
                <Button>Global inrichten</Button>
              </div>
            </form>
          ) : (
            <SetupTokenExchange />
          )}
        </Panel>
      </div>
    </Shell>
  );
}
