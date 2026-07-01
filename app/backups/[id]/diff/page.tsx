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
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

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
  const timeZone = await getTenantTimeZone(backup.fortigate.customer.tenantId);
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
  const diffLines = diff.split("\n");

  return (
    <Shell>
      <PageHeader
        title="Backup diff"
        description={`${backup.fortigate.customer.name} - ${backup.fortigate.hostname ?? backup.fortigate.managementUrl} - ${formatDateTime(previous.createdAt, timeZone)} naar ${formatDateTime(backup.createdAt, timeZone)}`}
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
      <section className="security-panel professional-surface mt-6 overflow-hidden rounded-md border border-border shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/70 px-4 py-3 pt-4">
          <div>
            <h2 className="font-semibold">Diff log</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              FortiGate export-metadata is genegeerd; alleen inhoudelijke configuratieregels staan hieronder.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              - verwijderd
            </span>
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              + toegevoegd
            </span>
          </div>
        </div>
        <div className="max-h-[72vh] overflow-auto bg-slate-950 text-slate-100">
          <ol className="min-w-max py-3 font-mono text-xs leading-6">
            {diffLines.map((line, index) => (
              <DiffLine key={`${index}-${line.slice(0, 16)}`} line={line} lineNumber={index + 1} />
            ))}
          </ol>
        </div>
      </section>
    </Shell>
  );
}

function DiffLine({ line, lineNumber }: { line: string; lineNumber: number }) {
  const kind = diffLineKind(line);
  const styles = {
    add: "bg-emerald-500/12 text-emerald-100",
    remove: "bg-red-500/14 text-red-100",
    hunk: "bg-sky-500/12 text-sky-200",
    header: "bg-slate-800/80 text-slate-300",
    context: "text-slate-300"
  }[kind];
  const markerStyles = {
    add: "text-emerald-300",
    remove: "text-red-300",
    hunk: "text-sky-300",
    header: "text-slate-400",
    context: "text-slate-500"
  }[kind];

  return (
    <li className={`grid grid-cols-[72px_28px_minmax(720px,1fr)] border-l-4 ${borderColor(kind)} ${styles}`}>
      <span className="select-none border-r border-white/10 px-3 text-right text-slate-500">{lineNumber}</span>
      <span className={`select-none px-2 text-center font-bold ${markerStyles}`}>{lineMarker(line)}</span>
      <code className="whitespace-pre px-2">{lineBody(line)}</code>
    </li>
  );
}

function diffLineKind(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "header" as const;
  if (line.startsWith("@@")) return "hunk" as const;
  if (line.startsWith("+")) return "add" as const;
  if (line.startsWith("-")) return "remove" as const;
  return "context" as const;
}

function borderColor(kind: ReturnType<typeof diffLineKind>) {
  if (kind === "add") return "border-emerald-400/70";
  if (kind === "remove") return "border-red-400/70";
  if (kind === "hunk") return "border-sky-400/60";
  return "border-transparent";
}

function lineMarker(line: string) {
  if (line.startsWith("+++")) return "+";
  if (line.startsWith("---")) return "-";
  if (line.startsWith("@@")) return "@";
  if (line.startsWith("+") || line.startsWith("-")) return line[0];
  return "";
}

function lineBody(line: string) {
  if (line.startsWith("+") || line.startsWith("-")) return line.slice(1);
  return line;
}
