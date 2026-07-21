import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { prisma } from "@/lib/db";
import { hasAvailableEntraSso } from "@/lib/entra-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const tenantCount = await prisma.tenant.count();
  if (tenantCount === 0) redirect("/setup");
  const [{ error }, ssoAvailable] = await Promise.all([
    searchParams,
    hasAvailableEntraSso().catch(() => false)
  ]);

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,.9fr)]">
      <section className="relative hidden overflow-hidden bg-[hsl(var(--header))] p-12 text-[hsl(var(--header-foreground))] lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-15 [background-image:linear-gradient(rgba(255,255,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.18)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative font-mono text-sm font-bold tracking-[0.22em]">FORTI BACKUP</div>
        <div className="relative max-w-xl"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Security operations</p><h2 className="font-display text-5xl font-semibold leading-[1.12] tracking-[-0.015em]">Elke configuratie.<br/>Veilig vastgelegd.</h2><p className="mt-6 max-w-lg text-lg leading-7 text-white/65">Centraal beheer, geverifieerde snapshots en een volledig auditspoor voor iedere FortiGate binnen je MSP-omgeving.</p></div>
        <div className="relative flex items-center gap-3 text-sm text-white/55"><span className="status-pulse"/>Productieomgeving beveiligd</div>
      </section>
      <section className="grid place-items-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[430px]">
          <div className="mb-10 font-mono text-xs font-bold tracking-[0.18em] lg:hidden">FORTI BACKUP</div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-success">Welkom terug</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.015em]">Inloggen</h1>
          <p className="mb-8 mt-2 text-base text-muted-foreground">Gebruik je organisatieaccount om verder te gaan.</p>
          <LoginForm
            ssoAvailable={ssoAvailable}
            externalError={error ? "Inloggen is niet gelukt. Controleer uw account of neem contact op met uw beheerder." : undefined}
          />
        </div>
      </section>
    </main>
  );
}
