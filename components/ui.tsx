import Link from "next/link";
import { clsx } from "clsx";
import { logoutAction, switchTenantContextAction } from "@/app/actions";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const canManageTenants = user ? isSuperAdmin(user) : false;
  const tenants = canManageTenants
    ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const currentTenantId = user?.activeTenantId ?? user?.tenantId ?? null;
  const isGlobalContext = await isGlobalTenantId(currentTenantId);
  const tenantName = user?.activeTenant?.name ?? user?.tenant?.name ?? "Geen tenant";

  return (
    <div className="min-h-screen bg-background/80">
      <header className="sticky top-0 z-30 border-b border-black/25 bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))] shadow-lg shadow-slate-950/10">
        <div className="h-0.5 bg-gradient-to-r from-primary to-[hsl(var(--accent))]" />
        <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={user ? "/" : "/login"} className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-md border border-white/10 bg-primary text-sm font-black text-primary-foreground shadow-sm shadow-primary/30">
                FB
              </span>
              <span>
                <span className="block text-sm font-semibold leading-4">FortiGate Backup</span>
                <span className="block text-xs text-white/60">Security operations portal</span>
              </span>
            </Link>
            {user ? (
              <div className="flex flex-wrap items-center gap-2">
                <TenantSwitcher
                  action={switchTenantContextAction}
                  activeTenantId={user.activeTenantId}
                  canSwitch={canManageTenants}
                  tenantName={tenantName}
                  tenants={tenants}
                />
                <form action={logoutAction}>
                  <button className="rounded-md border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72 transition hover:bg-white/10 hover:text-white">
                    Uitloggen
                  </button>
                </form>
              </div>
            ) : (
              <Link className="rounded-md border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72 transition hover:bg-white/10 hover:text-white" href="/login">
                Inloggen
              </Link>
            )}
          </div>
          {user ? (
            <div className="overflow-x-auto">
              <nav className="flex w-max min-w-full items-center gap-1 rounded-md border border-white/10 bg-white/[0.055] p-1 text-sm text-white/70">
                <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/">
                  Dashboard
                </Link>
                {!isGlobalContext ? (
                  <>
                    <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/customers">
                      Klanten
                    </Link>
                    <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/fortigates">
                      FortiGates
                    </Link>
                    <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/backups">
                      Backups
                    </Link>
                    <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/alerts">
                      Alerts
                    </Link>
                  </>
                ) : null}
                {canManageTenants && isGlobalContext ? (
                  <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/tenants">
                    Tenants
                  </Link>
                ) : null}
                <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/roles">
                  Rollen
                </Link>
                <Link className="rounded px-3 py-1.5 transition hover:bg-white/10 hover:text-white" href="/settings">
                  Instellingen
                </Link>
              </nav>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="professional-surface mb-6 flex flex-wrap items-start justify-between gap-4 rounded-md border border-border px-5 py-4 shadow-sm shadow-slate-900/5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("security-panel professional-surface overflow-hidden rounded-md border border-border shadow-sm shadow-slate-900/5", className)}>
      {title || description ? (
        <div className="border-b border-border bg-surface/60 px-5 py-4 pt-5">
          {title ? <h2 className="font-semibold">{title}</h2> : null}
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-auto rounded-md border border-border bg-surface shadow-sm shadow-slate-900/5", className)}>
      {children}
    </div>
  );
}

export function Card({
  title,
  value,
  detail,
  className
}: {
  title: string;
  value: string | number;
  detail?: string;
  className?: string;
}) {
  return (
    <section className={clsx("security-panel professional-surface overflow-hidden rounded-md border border-border p-5 pt-6 shadow-sm shadow-slate-900/5", className)}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "border-border bg-muted text-muted-foreground",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
  };
  return (
    <span className={clsx("inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90",
    secondary: "border border-border bg-surface text-foreground hover:border-primary/45 hover:bg-muted",
    danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
  };
  return (
    <button
      className={clsx(
        "inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ActionLink({
  children,
  href,
  variant = "secondary",
  target
}: {
  children: React.ReactNode;
  href: string;
  variant?: "primary" | "secondary" | "danger";
  target?: string;
}) {
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90",
    secondary: "border border-border bg-surface text-foreground hover:border-primary/45 hover:bg-muted",
    danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
  };
  return (
    <Link className={clsx("inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition", variants[variant])} href={href} target={target}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required,
  defaultValue
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input
        className="rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  );
}
