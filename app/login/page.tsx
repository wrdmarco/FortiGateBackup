import { LoginForm } from "@/components/login-form";
import { Panel, Shell } from "@/components/ui";

export default function LoginPage() {
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
