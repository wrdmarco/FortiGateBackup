import Link from "next/link";
import Image from "next/image";
import { BrandWordmark } from "@/components/brand-wordmark";
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
  const tenants = canSwitchTenants ? await prisma.tenant.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const isBreakGlassSettingsOnly = Boolean(user?.breakGlassSettingsOnly);
  const canReadUsers = permissionKeys.has(isGlobalContext ? "platform.users.read" : "tenant.users.read");
  const canReadAudit = permissionKeys.has(isGlobalContext ? "platform.audit.read" : "audit.read");
  const tenantName = user?.activeTenant?.name ?? user?.tenant?.name ?? "Geen tenant";

  const navigation = <NavigationLinks canManageTenants={canReadTenants} canReadAudit={canReadAudit} canReadUsers={canReadUsers} isBreakGlassSettingsOnly={isBreakGlassSettingsOnly} isGlobalContext={isGlobalContext} />;

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">Naar hoofdinhoud</a>
      <aside className="app-sidebar hidden min-h-screen flex-col bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))] lg:sticky lg:top-0 lg:flex lg:h-screen">
        <BrandLink href={user ? "/" : "/login"} />
        {user ? <nav aria-label="Hoofdnavigatie" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">{navigation}</nav> : null}
      </aside>
      <div className="min-w-0">
        <header className="app-header sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-sm">
          <div className="flex min-h-[4.5rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden"><BrandLink href={user ? "/" : "/login"} compact /></div>
            {user ? <div className="hidden min-w-0 items-center gap-3 lg:flex"><span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant</span><TenantSwitcher key={user.activeTenantId ?? "no-tenant"} action={switchTenantContextAction} activeTenantId={user.activeTenantId} canSwitch={canSwitchTenants} tenantName={tenantName} tenants={tenants} /></div> : null}
            {user ? <div className="ml-auto flex min-w-0 items-center gap-2"><Link href="/help" aria-label="Help" className="topbar-icon"><Icon name="help" /></Link><HeaderUserMenu email={user.email} isBreakGlassSettingsOnly={isBreakGlassSettingsOnly} logoutAction={logoutAction} name={user.name} /></div> : <Link className="ml-auto inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" href="/login">Inloggen</Link>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1680px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6 xl:px-10" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

function BrandLink({ href, compact = false }: { href: string; compact?: boolean }) {
  return <Link href={href} aria-label="Forti Backup - overzicht" className={clsx("brand-mark inline-flex min-h-11 items-center gap-2.5 rounded-lg", compact ? "px-0" : "mx-4 my-4 px-1")}><Image alt="" aria-hidden height={compact ? 30 : 38} src={compact ? "/brand/forti-backup-mark-light.svg" : "/brand/forti-backup-mark-dark.svg"} width={compact ? 30 : 38}/><BrandWordmark inverse={!compact} size={compact ? "compact" : "default"}/></Link>;
}

function NavigationLinks({ isBreakGlassSettingsOnly, isGlobalContext, canManageTenants, canReadUsers, canReadAudit }: { isBreakGlassSettingsOnly: boolean; isGlobalContext: boolean; canManageTenants: boolean; canReadUsers: boolean; canReadAudit: boolean }) {
  if (isBreakGlassSettingsOnly) return <><span className="flex min-h-11 items-center rounded-lg bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-200">Break-glass toegang</span><AppNavLink href="/settings?tab=sso"><Icon name="settings"/>SSO instellingen</AppNavLink></>;
  return <>
    <AppNavLink href="/"><Icon name="overview"/>Overzicht</AppNavLink>
    {!isGlobalContext ? <><AppNavLink href="/customers"><Icon name="device"/>Klanten & FortiGates</AppNavLink><AppNavLink href="/queue"><Icon name="queue"/>Queue</AppNavLink><AppNavLink href="/alerts"><Icon name="alert"/>Alerts</AppNavLink></> : null}
    {canManageTenants && isGlobalContext ? <AppNavLink href="/tenants"><Icon name="tenant"/>Tenants</AppNavLink> : null}
    {canReadUsers ? <AppNavLink href="/users"><Icon name="user"/>Gebruikers</AppNavLink> : null}
    <AppNavLink href="/roles"><Icon name="shield"/>Rollen</AppNavLink>
    {canReadAudit ? <AppNavLink href="/audit"><Icon name="audit"/>Auditlog</AppNavLink> : null}
    <AppNavLink href="/settings"><Icon name="settings"/>Instellingen</AppNavLink>
  </>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header mb-6 flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.012em] sm:text-[2rem]">{title}</h1>{description ? <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{description}</p> : null}</div>{actions ? <div className="page-actions flex flex-wrap gap-2">{actions}</div> : null}</header>;
}

export function Panel({ title, description, children, className }: { title?: string; description?: string; children: React.ReactNode; className?: string }) {
  return <section className={clsx("security-panel overflow-hidden rounded-[0.625rem] border border-border bg-surface shadow-panel", className)}>{title || description ? <div className="border-b border-border px-5 py-4">{title ? <h2 className="font-display text-base font-semibold tracking-[-0.01em]">{title}</h2> : null}{description ? <p className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground">{description}</p> : null}</div> : null}<div className="p-5">{children}</div></section>;
}

export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) { return <div className={clsx("overflow-auto rounded-[0.625rem] border border-border bg-surface shadow-panel", className)}>{children}</div>; }

export function Card({ title, value, detail, className }: { title: string; value: string | number; detail?: string; className?: string }) { return <section className={clsx("security-panel overflow-hidden rounded-[0.625rem] border border-border bg-surface p-4 shadow-panel", className)}><p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p><p className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground">{value}</p>{detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}</section>; }

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const tones = { neutral: "border-border bg-muted text-muted-foreground", success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300", warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300", danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" };
  return <span className={clsx("inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Button({ children, variant = "primary", className, ...props }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = { primary: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90", secondary: "border border-border bg-surface text-foreground hover:border-primary/45 hover:bg-muted", danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950" };
  return <button className={clsx("inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45", variants[variant], className)} {...props}>{children}</button>;
}

export function ActionLink({ children, href, variant = "secondary", target }: { children: React.ReactNode; href: string; variant?: "primary" | "secondary" | "danger"; target?: string }) {
  const variants = { primary: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90", secondary: "border border-border bg-surface text-foreground hover:border-primary/45 hover:bg-muted", danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950" };
  return <Link className={clsx("inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition", variants[variant])} href={href} target={target}>{children}</Link>;
}

export function Field({ label, className, ...inputProps }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="grid gap-1.5 text-sm"><span className="font-medium text-foreground">{label}</span><input className={clsx("min-h-11 rounded-lg border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15", className)} {...inputProps}/></label>; }

export function FilterBar({ children }: { children: React.ReactNode }) { return <div className="filter-bar mb-4 rounded-[0.625rem] border border-border bg-surface-soft/55 p-3 sm:p-4">{children}</div>; }

export function SectionHeading({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) { return <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-semibold tracking-[-0.008em]">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}</div>{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}</div>; }

type IconName = "overview" | "device" | "queue" | "alert" | "tenant" | "user" | "shield" | "audit" | "settings" | "help" | "check" | "database" | "archive" | "clock" | "arrow";
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>, device: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 8h.01M10 8h.01"/></>, queue: <><path d="M4 6h16M4 12h12M4 18h8"/><path d="m17 15 3 3-3 3"/></>, alert: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>, tenant: <><path d="M4 21V5l8-3 8 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>, shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></>, audit: <><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>, help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 3.5 2.6c-.7.3-1 1-1 1.7M12 17h.01"/></>, check: <path d="m5 12 4 4L19 6"/>, database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>, archive: <><rect x="3" y="5" width="18" height="4" rx="1"/><path d="M5 9v11h14V9M10 13h4"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, arrow: <path d="m9 18 6-6-6-6"/>
  };
  return <svg aria-hidden="true" className={clsx("ui-icon", className)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
