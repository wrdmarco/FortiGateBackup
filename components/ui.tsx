import Link from "next/link";
import { clsx } from "clsx";
import { logoutAction } from "@/app/actions";
import { isSuperAdmin } from "@/lib/authz";
import { currentUser } from "@/lib/session";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const canManageTenants = user ? isSuperAdmin(user) : false;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="text-lg font-semibold">
            FortiGate Backup Portal
          </Link>
          <nav className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Link className="rounded px-3 py-2 hover:bg-muted" href="/">
              Dashboard
            </Link>
            <Link className="rounded px-3 py-2 hover:bg-muted" href="/customers">
              Klanten
            </Link>
            <Link className="rounded px-3 py-2 hover:bg-muted" href="/fortigates">
              FortiGates
            </Link>
            <Link className="rounded px-3 py-2 hover:bg-muted" href="/backups">
              Backups
            </Link>
            {canManageTenants ? (
              <Link className="rounded px-3 py-2 hover:bg-muted" href="/tenants">
                Tenants
              </Link>
            ) : null}
            <Link className="rounded px-3 py-2 hover:bg-muted" href="/settings">
              Instellingen
            </Link>
          </nav>
          <form action={logoutAction}>
            <button className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
              Uitloggen
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
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
    <section className={clsx("rounded-md border border-border bg-background p-4", className)}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
    </section>
  );
}

export function Button({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
      {children}
    </button>
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
        className="rounded-md border border-border px-3 py-2"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  );
}
