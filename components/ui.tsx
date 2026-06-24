import Link from "next/link";
import { clsx } from "clsx";
import { logoutAction } from "@/app/actions";
import { isSuperAdmin } from "@/lib/authz";
import { currentUser } from "@/lib/session";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const canManageTenants = user ? isSuperAdmin(user) : false;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Link href={user ? "/" : "/login"} className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              FB
            </span>
            <span>
              <span className="block text-sm font-semibold leading-4">FortiGate Backup</span>
              <span className="block text-xs text-muted-foreground">MSP portal</span>
            </span>
          </Link>
          {user ? (
            <>
              <nav className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-1 text-sm text-muted-foreground">
                <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/">
                  Dashboard
                </Link>
                <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/customers">
                  Klanten
                </Link>
                <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/fortigates">
                  FortiGates
                </Link>
                <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/backups">
                  Backups
                </Link>
                {canManageTenants ? (
                  <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/tenants">
                    Tenants
                  </Link>
                ) : null}
                <Link className="rounded px-3 py-1.5 hover:bg-surface hover:text-foreground" href="/settings">
                  Instellingen
                </Link>
              </nav>
              <form action={logoutAction}>
                <button className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                  Uitloggen
                </button>
              </form>
            </>
          ) : (
            <Link className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted" href="/login">
              Inloggen
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
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
    <section className={clsx("rounded-md border border-border bg-surface shadow-sm", className)}>
      {title || description ? (
        <div className="border-b border-border px-5 py-4">
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
    <div className={clsx("overflow-auto rounded-md border border-border bg-surface shadow-sm", className)}>
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
    <section className={clsx("rounded-md border border-border bg-surface p-5 shadow-sm", className)}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
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
    success: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
  };
  return (
    <span className={clsx("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border border-border bg-surface text-foreground hover:bg-muted",
    danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
  };
  return (
    <button className={clsx("rounded-md px-4 py-2 text-sm font-medium transition", variants[variant], className)}>
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
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border border-border bg-surface text-foreground hover:bg-muted",
    danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
  };
  return (
    <Link className={clsx("rounded-md px-4 py-2 text-sm font-medium transition", variants[variant])} href={href} target={target}>
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
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
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
