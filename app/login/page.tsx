import { loginAction } from "@/app/actions";
import { Button, Field, Panel, Shell } from "@/components/ui";

export default function LoginPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-md pt-8">
        <Panel title="Inloggen" description="Gebruik je portaalaccount om backups en FortiGates te beheren.">
        <form action={loginAction} className="grid gap-4">
          <Field label="E-mail" name="email" type="email" required />
          <Field label="Wachtwoord" name="password" type="password" required />
          <Button>Inloggen</Button>
        </form>
        </Panel>
      </div>
    </Shell>
  );
}
