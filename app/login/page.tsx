import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const tenantCount = await prisma.tenant.count();
  if (tenantCount === 0) redirect("/setup");

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="security-panel w-full max-w-[420px] overflow-hidden rounded-md border border-border bg-surface shadow-xl shadow-slate-900/10 dark:shadow-black/30">
        <div className="border-b border-border bg-[hsl(var(--header))] px-6 py-5 pt-6 text-[hsl(var(--header-foreground))]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-primary text-sm font-black text-primary-foreground shadow-sm shadow-primary/30">
              FB
            </div>
            <div>
              <p className="text-sm font-semibold leading-5">FortiGate Backup</p>
              <h1 className="text-xl font-semibold tracking-tight text-white">Inloggen</h1>
            </div>
          </div>
        </div>
        <div className="px-6 py-6">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
