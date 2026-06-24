import { notFound } from "next/navigation";
import {
  backupDisplayName,
  getBackupForUser,
  previousStoredBackup,
  readBackupText,
  unifiedDiff
} from "@/lib/backups";
import { requireTenantUser } from "@/lib/authz";
import { ActionLink, Card, PageHeader, Panel, Shell } from "@/components/ui";

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
        <PageHeader
          title="Backup diff"
          description={`${backup.fortigate.customer.name} - ${backup.fortigate.hostname ?? backup.fortigate.managementUrl}`}
          actions={<ActionLink href="/backups">Terug</ActionLink>}
        />
        <Panel>
        <div className="text-sm text-muted-foreground">
          Er is nog geen eerdere opgeslagen backup voor deze FortiGate om mee te vergelijken.
        </div>
        </Panel>
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
      <PageHeader
        title="Backup diff"
        description={`${backup.fortigate.customer.name} - ${backup.fortigate.hostname ?? backup.fortigate.managementUrl} - ${previous.createdAt.toLocaleString("nl-NL")} naar ${backup.createdAt.toLocaleString("nl-NL")}`}
        actions={
          <>
            <ActionLink href={`/api/backups/${previous.id}/download`}>Vorige downloaden</ActionLink>
            <ActionLink href={`/api/backups/${backup.id}/download`}>Huidige downloaden</ActionLink>
            <ActionLink href="/backups">Terug</ActionLink>
          </>
        }
      />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card title="Toegevoegd" value={added} detail="Regels in huidige backup" />
        <Card title="Verwijderd" value={removed} detail="Regels uit vorige backup" />
      </div>
      <pre className="mt-6 max-h-[70vh] overflow-auto rounded-md border border-border bg-surface p-4 text-xs leading-relaxed shadow-sm">
        <code>{diff}</code>
      </pre>
    </Shell>
  );
}
