import { redirect } from "next/navigation";
import Image from "next/image";
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
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_top,hsl(var(--primary)/.16),transparent_34rem)]" />
      <section className="relative w-full max-w-[440px] rounded-xl border border-border bg-surface p-6 shadow-2xl shadow-slate-950/10 sm:p-8 dark:shadow-black/30">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image className="dark:hidden" alt="" aria-hidden height={68} src="/brand/forti-backup-mark-light.svg" width={68}/>
          <Image className="hidden dark:block" alt="" aria-hidden height={68} src="/brand/forti-backup-mark-dark.svg" width={68}/>
          <div className="mt-3 font-mono text-sm font-bold tracking-[0.14em]"><span className="text-[#d91f2a] dark:text-[#ef2935]">FORTI</span><span className="text-foreground"> BACKUP</span></div>
        </div>
        <div className="border-t border-border pt-6">
          <h1 className="mb-6 text-center font-display text-2xl font-semibold tracking-[-0.01em]">Inloggen</h1>
          <LoginForm
            ssoAvailable={ssoAvailable}
            externalError={error ? "Inloggen is niet gelukt. Controleer uw account of neem contact op met uw beheerder." : undefined}
          />
        </div>
      </section>
    </main>
  );
}
