import Link from "next/link";
import { notFound } from "next/navigation";
import {
  backupDisplayName,
  getBackupForUser,
  previousStoredBackup,
  readBackupText,
  unifiedDiff
} from "@/lib/backups";
import { requireTenantUser } from "@/lib/authz";
import { Shell } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BackupDiffPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireTenantUser();
  const { id } = await params;
  const backup = await getBackupForUser(id, user);
  if (!backup.filename) notFound();
  const previous = await previousStoredBackup(backup);
  if (!previous?.filename) {
    return (
      <Shell>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Backup diff</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {backup.fortigate.customer.name} - {backup.fortigate.hostname ?? backup.fortigate.managementUrl}
            </p>
          </div>
          <Link className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted" href="/backups">
            Terug
          </Link>
        </div>
        <div className="mt-6 rounded-md border border-border p-4 text-sm text-muted-foreground">
          Er is nog geen eerdere opgeslagen backup voor deze FortiGate om mee te vergelijken.
        </div>
      </Shell>
    );
  }

  const [previousText, currentText] = await Promise.all([
    readBackupText(previous),
    readBackupText(backup)
  ]);
  const diff = unifiedDiff(
    previousText,
    currentText,
    backupDisplayName(previous),
    backupDisplayName(backup)
  );
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Backup diff</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {backup.fortigate.customer.name} - {backup.fortigate.hostname ?? backup.fortigate.managementUrl}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {previous.createdAt.toLocaleString("nl-NL")} naar {backup.createdAt.toLocaleString("nl-NL")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            href={`/api/backups/${previous.id}/download`}
          >
            Vorige downloaden
          </Link>
          <Link
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            href={`/api/backups/${backup.id}/download`}
          >
            Huidige downloaden
          </Link>
          <Link className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted" href="/backups">
            Terug
          </Link>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Toegevoegd</p>
          <p className="mt-1 text-2xl font-semibold text-green-700 dark:text-green-300">{added}</p>
        </div>
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Verwijderd</p>
          <p className="mt-1 text-2xl font-semibold text-red-700 dark:text-red-300">{removed}</p>
        </div>
      </div>
      <pre className="mt-6 max-h-[70vh] overflow-auto rounded-md border border-border bg-muted p-4 text-xs leading-relaxed">
        <code>{diff}</code>
      </pre>
    </Shell>
  );
}
