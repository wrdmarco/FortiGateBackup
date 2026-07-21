import Link from "next/link";
import { clsx } from "clsx";
import { logoutAction, switchTenantContextAction } from "@/app/actions";
import { AppNavLink, HeaderUserMenu } from "@/components/modal";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { prisma } from "@/lib/db";
import { userPermissionKeys } from "@/lib/rbac";
import { currentUser } from "@/lib/session";
import { isGlobalTenantId } from "@/lib/tenant-main";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const currentTenantId = user?.activeTenantId ?? user?.tenantId ?? null;
  const isGlobalContext = await isGlobalTenantId(currentTenantId);
  const permissionKeys = user ? await userPermissionKeys(user) : new Set<string>();
  const canSwitchTenants = permissionKeys.has("platform.tenants.switch");
  const canReadTenants = isGlobalContext && permissionKeys.has("platform.tenants.read");
  const tenants = canSwitchTenants
    ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const isBreakGlassSettingsOnly = Boolean(user?.breakGlassSettingsOnly);
  const canReadUsers = permissionKeys.has(isGlobalContext ? "platform.users.read" : "tenant.users.read");
  const canReadAudit = permissionKeys.has(isGlobalContext ? "platform.audit.read" : "audit.read");
  const tenantName = user?.activeTenant?.name ?? user?.tenant?.name ?? "Geen tenant";

  return (
    <div className="min-h-screen bg-background/80">
      <a className="skip-link" href="#main-content">
        Naar hoofdinhoud
      </a>
      <header className="app-header sticky top-0 z-30 border-b border-black/25 bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))] shadow-lg shadow-slate-950/10">
        <div className="h-0.5 bg-primary" />
        <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={user ? "/" : "/login"} className="flex min-h-11 shrink-0 items-center gap-3 rounded-sm">
              <span className="grid h-10 w-10 place-items-center rounded-md border border-white/10 bg-primary text-sm font-black text-primary-foreground shadow-sm shadow-primary/30">
                FB
              </span>
              <span className="hidden sm:block">
                <span className="block text-sm font-semibold leading-4">FortiGate Backup</span>
                <span className="block text-xs text-white/60">Security operations portal</span>
              </span>
            </Link>
            {user ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <div className="min-w-0 max-w-[min(15rem,45vw)] [&>span]:block [&>span]:truncate [&_select]:max-w-full">
                  <TenantSwitcher
                    key={user.activeTenantId ?? "no-tenant"}
                    action={switchTenantContextAction}
                    activeTenantId={user.activeTenantId}
                    canSwitch={canSwitchTenants}
                    tenantName={tenantName}
                    tenants={tenants}
                  />
                </div>
                <HeaderUserMenu
                  email={user.email}
                  isBreakGlassSettingsOnly={isBreakGlassSettingsOnly}
                  logoutAction={logoutAction}
                  name={user.name}
                />
              </div>
            ) : (
              <Link className="inline-flex min-h-11 items-center rounded-md border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white" href="/login">
                Inloggen
              </Link>
            )}
          </div>
          {user ? (
            <>
              <nav aria-label="Hoofdnavigatie" className="hidden flex-wrap items-center gap-1 rounded-md border border-white/10 bg-white/[0.055] p-1 md:flex">
                <NavigationLinks
                  canManageTenants={canReadTenants}
                  canReadAudit={canReadAudit}
                  canReadUsers={canReadUsers}
                  isBreakGlassSettingsOnly={isBreakGlassSettingsOnly}
                  isGlobalContext={isGlobalContext}
                />
              </nav>
              <details className="group md:hidden">
                <summary className="app-nav-summary flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-white/[0.055] px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
                  <span aria-hidden="true" className="relative block h-4 w-5 shrink-0">
                    <span className="absolute left-0 top-0 h-0.5 w-5 rounded bg-current transition-transform group-open:translate-y-[7px] group-open:rotate-45" />
                    <span className="absolute left-0 top-[7px] h-0.5 w-5 rounded bg-current transition-opacity group-open:opacity-0" />
                    <span className="absolute bottom-0 left-0 h-0.5 w-5 rounded bg-current transition-transform group-open:-translate-y-[7px] group-open:-rotate-45" />
                  </span>
                  Menu
                </summary>
                <nav aria-label="Mobiele hoofdnavigatie" className="mt-2 grid gap-1 rounded-md border border-white/10 bg-white/[0.055] p-1">
                  <NavigationLinks
                    canManageTenants={canReadTenants}
                    canReadAudit={canReadAudit}
                    canReadUsers={canReadUsers}
                    isBreakGlassSettingsOnly={isBreakGlassSettingsOnly}
                    isGlobalContext={isGlobalContext}
                  />
                </nav>
              </details>
            </>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 outline-none lg:px-6 lg:py-8" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function NavigationLinks({
  isBreakGlassSettingsOnly,
  isGlobalContext,
  canManageTenants,
  canReadUsers,
  canReadAudit
}: {
  isBreakGlassSettingsOnly: boolean;
  isGlobalContext: boolean;
  canManageTenants: boolean;
  canReadUsers: boolean;
  canReadAudit: boolean;
}) {
  if (isBreakGlassSettingsOnly) {
    return (
      <>
        <span className="flex min-h-11 items-center rounded bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100">Break-glass toegang</span>
        <AppNavLink href="/settings?tab=sso">SSO instellingen</AppNavLink>
      </>
    );
  }

  return (
    <>
      <AppNavLink href="/">Dashboard</AppNavLink>
      {!isGlobalContext ? (
        <>
          <AppNavLink href="/customers">Klanten</AppNavLink>
          <AppNavLink href="/alerts">Alerts</AppNavLink>
        </>
      ) : null}
      {canManageTenants && isGlobalContext ? <AppNavLink href="/tenants">Tenants</AppNavLink> : null}
      {canReadUsers ? <AppNavLink href="/users">Gebruikers</AppNavLink> : null}
      <AppNavLink href="/roles">Rollen</AppNavLink>
      {canReadAudit ? <AppNavLink href="/audit">Audit</AppNavLink> : null}
      <AppNavLink href="/settings">Instellingen</AppNavLink>
    </>
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
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
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
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
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
    <Link className={clsx("inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition", variants[variant])} href={href} target={target}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  className,
  ...inputProps
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input
        className={clsx(
          "min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15",
          className
        )}
        {...inputProps}
      />
    </label>
  );
}
