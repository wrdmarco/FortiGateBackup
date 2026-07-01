import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/change-password-form";
import { Panel, Shell } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  if (!user.mustChangePassword) redirect("/");

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <Panel
          title="Wachtwoord wijzigen"
          description="Je gebruikt nog een tijdelijk wachtwoord. Kies eerst een nieuw wachtwoord voordat je verdergaat."
        >
          <ChangePasswordForm />
        </Panel>
      </div>
    </Shell>
  );
}
