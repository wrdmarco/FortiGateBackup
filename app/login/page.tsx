import { loginAction } from "@/app/actions";
import { Button, Field, Shell } from "@/components/ui";

export default function LoginPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold">Inloggen</h1>
        <form action={loginAction} className="mt-6 grid gap-4 rounded-md border border-border p-4">
          <Field label="E-mail" name="email" type="email" required />
          <Field label="Wachtwoord" name="password" type="password" required />
          <Button>Inloggen</Button>
        </form>
      </div>
    </Shell>
  );
}
