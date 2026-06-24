import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { Panel, Shell } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const tenantCount = await prisma.tenant.count();
  if (tenantCount === 0) redirect("/setup");

  return (
    <Shell>
      <div className="mx-auto max-w-md pt-8">
        <Panel title="Inloggen" description="Gebruik je portaalaccount om backups en FortiGates te beheren.">
          <LoginForm />
        </Panel>
      </div>
    </Shell>
  );
}