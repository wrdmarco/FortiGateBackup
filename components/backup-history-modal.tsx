"use client";

import { useMemo, useState } from "react";

type BackupHistoryItem = {
  id: string;
  createdAt: string;
  status: "CHANGED" | "UNCHANGED" | "FAILED";
  sha256: string | null;
  error: string | null;
  filesize: number;
  filename: string | null;
  itGlueUploaded: boolean;
  itGlueError: string | null;
  autotaskTicketId: string | null;
  autotaskError: string | null;
  downloadHref: string;
  diffHref: string;
};

type BackupFilter = "all" | "without-unchanged" | "changed" | "failed" | "downloadable";

export function BackupHistoryModal({
  backups,
  canDownload,
  canReadDiff
}: {
  backups: BackupHistoryItem[];
  canDownload: boolean;
  canReadDiff: boolean;
}) {
  const [filter, setFilter] = useState<BackupFilter>("all");
  const filteredBackups = useMemo(() => {
    return backups.filter((backup) => {
      if (filter === "changed") return backup.status === "CHANGED";
      if (filter === "failed") return backup.status === "FAILED";
      if (filter === "without-unchanged") return backup.status !== "UNCHANGED";
      if (filter === "downloadable") return Boolean(backup.filename);
      return true;
    });
  }, [backups, filter]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Standaard zie je alle backup runs, inclusief `UNCHANGED`, zodat de volledige log zichtbaar blijft.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Filter</span>
          <select
            className="rounded-md border border-border bg-surface px-3 py-2"
            value={filter}
            onChange={(event) => setFilter(event.target.value as BackupFilter)}
          >
            <option value="all">Alle backups</option>
            <option value="without-unchanged">Zonder unchanged</option>
            <option value="changed">Alleen gewijzigd</option>
            <option value="failed">Alleen fouten</option>
            <option value="downloadable">Downloadbaar</option>
          </select>
        </label>
      </div>
      <div className="overflow-auto rounded-md border border-border bg-surface">
        <table className="table-pro w-full min-w-[920px] text-left text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="px-3 py-2">Datum</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SHA256 / fout</th>
              <th className="px-3 py-2">Grootte</th>
              <th className="px-3 py-2">IT Glue</th>
              <th className="px-3 py-2">Autotask</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {filteredBackups.length ? filteredBackups.map((backup) => (
              <tr key={backup.id} className="border-t border-border align-top">
                <td className="px-3 py-2">{backup.createdAt}</td>
                <td className="px-3 py-2">
                  <span className={backup.status === "FAILED" ? dangerBadge : backup.status === "CHANGED" ? warningBadge : successBadge}>{backup.status}</span>
                </td>
                <td className="max-w-[420px] truncate px-3 py-2 font-mono text-xs">{backup.sha256 ?? backup.error ?? "-"}</td>
                <td className="px-3 py-2">{backup.filesize}</td>
                <td className="px-3 py-2">
                  {backup.itGlueUploaded ? (
                    <span className={successBadge}>Geupload</span>
                  ) : backup.itGlueError ? (
                    <span className={warningBadge}>Fout</span>
                  ) : (
                    <span className={neutralBadge}>-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {backup.autotaskTicketId ? (
                    <span className={successBadge}>Ticket {backup.autotaskTicketId}</span>
                  ) : backup.autotaskError ? (
                    <span className={warningBadge}>Fout</span>
                  ) : (
                    <span className={neutralBadge}>-</span>
                  )}
                </td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename ? (
                    <>
                      {canDownload ? <a className={actionClass} href={backup.downloadHref}>Download</a> : null}
                      {canReadDiff ? <a className={actionClass} href={backup.diffHref}>Diff</a> : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Geen bestand</span>
                  )}
                </td>
              </tr>
            )) : (
              <tr className="border-t border-border">
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                  Geen backups voor dit filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const actionClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-primary/45 hover:bg-muted";
const neutralBadge = "inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground";
const successBadge = "inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
const warningBadge = "inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
const dangerBadge = "inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
