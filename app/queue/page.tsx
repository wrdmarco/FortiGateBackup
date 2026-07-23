import { BackupJobStatus, BackupJobTrigger, SecurityAnalysisJobStatus } from "@prisma/client";
import { cancelQueuedBackupAction, retryFailedBackupAction, runQueuedBackupNowAction } from "@/app/actions";
import { retryAnalysisAction } from "@/app/security/actions";
import { Modal } from "@/components/modal";
import { Badge, Button, Card, Icon, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { tenantTransaction } from "@/lib/tenant-db";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const user = await requirePermission("fortigates.backup.run");
  const tenantId = tenantFilter(user);
  await assertOperationalTenant(user, tenantId ?? null);
  if (!tenantId) throw new Error("De actieve tenantcontext ontbreekt.");
  // eslint-disable-next-line react-hooks/purity -- Server-side database cutoff, not rendered state.
  const recentAnalysisCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [timeZone, canRunAnalyses, jobs, analysisJobs] = await Promise.all([
    getTenantTimeZone(tenantId),
    hasPermission(user, "security.analyses.run"),
    prisma.backupJob.findMany({
      where: { tenantId, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING, BackupJobStatus.FAILED] } },
      include: { fortigate: { include: { customer: { select: { id: true, name: true } } } } },
      orderBy: [{ status: "asc" }, { availableAt: "asc" }, { createdAt: "desc" }],
      take: 100
    }),
    tenantTransaction(tenantId, (tx) => tx.securityAnalysisJob.findMany({
      where: {
        tenantId,
        OR: [
          { status: { in: [SecurityAnalysisJobStatus.PENDING, SecurityAnalysisJobStatus.RUNNING, SecurityAnalysisJobStatus.FAILED, SecurityAnalysisJobStatus.BLOCKED] } },
          { status: SecurityAnalysisJobStatus.COMPLETED, finishedAt: { gte: recentAnalysisCutoff } }
        ]
      },
      include: {
        fortigate: { include: { customer: { select: { name: true } } } },
        analysis: { select: { id: true, configSha256: true, status: true } },
        events: { orderBy: { createdAt: "asc" }, take: 50 }
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100
    }))
  ]);

  const pending = jobs.filter((job) => job.status === BackupJobStatus.PENDING && job.attempts === 0).length;
  const running = jobs.filter((job) => job.status === BackupJobStatus.RUNNING).length;
  const retrying = jobs.filter((job) => job.status === BackupJobStatus.PENDING && job.attempts > 0).length;
  const failed = jobs.filter((job) => job.status === BackupJobStatus.FAILED).length;
  const analysisActive = analysisJobs.filter((job) => job.status === SecurityAnalysisJobStatus.PENDING || job.status === SecurityAnalysisJobStatus.RUNNING).length;
  const analysisFailed = analysisJobs.filter((job) => job.status === SecurityAnalysisJobStatus.FAILED || job.status === SecurityAnalysisJobStatus.BLOCKED).length;

  return <Shell>
    <PageHeader title="Queue" description="Live voortgang van backup- en analysetaken binnen de actieve tenant." />
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <Card title="Backups wachtend" value={pending} />
      <Card title="Backups actief" value={running} />
      <Card title="Backups retry" value={retrying} />
      <Card title="Backups mislukt" value={failed} />
      <Card title="Analyses actief" value={analysisActive} />
      <Card title="Analyses aandacht" value={analysisFailed} />
    </div>

    <section className="grid gap-3">
      <h2 className="font-display text-xl font-semibold">Analysetaken</h2>
      <TableShell>
        <table className="table-pro w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-surface-soft"><tr><th>FortiGate</th><th>Klant</th><th>Status</th><th>Actuele fase</th><th>Bijgewerkt</th><th>Pogingen</th><th>Actie</th></tr></thead>
          <tbody>
            {analysisJobs.length ? analysisJobs.map((job) => {
              const latest = job.events.at(-1);
              return <tr className="border-t border-border align-top" key={job.id}>
                <td>
                  <span className="flex items-center gap-2 font-semibold"><Icon name="shield" className="text-muted-foreground"/>{job.fortigate.hostname ?? job.fortigate.managementUrl}</span>
                  <span className="mt-1 block font-mono text-[0.7rem] text-muted-foreground">{job.analysis.configSha256.slice(0, 12)}</span>
                </td>
                <td>{job.fortigate.customer.name}</td>
                <td><AnalysisJobBadge status={job.status}/>{job.errorCode ? <p className="mt-1 text-xs text-danger">{analysisErrorLabel(job.errorCode)}</p> : null}</td>
                <td className="max-w-sm"><p className="font-medium">{latest?.message ?? "Taak wacht op de analyseworker."}</p><p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">{latest?.stage ?? "QUEUED"}</p></td>
                <td className="font-mono text-xs">{formatDateTime(job.updatedAt, timeZone)}</td>
                <td className="font-mono">{job.attempts}</td>
                <td>
                  <div className="grid gap-2">
                    {job.status === SecurityAnalysisJobStatus.COMPLETED ? <a className="text-sm font-semibold text-primary hover:underline" href={`/security/analyses/${job.analysis.id}`}>Open analyse</a> : null}
                    {canRunAnalyses && (job.status === SecurityAnalysisJobStatus.FAILED || job.status === SecurityAnalysisJobStatus.BLOCKED) ? <form action={retryAnalysisAction}><input name="analysisId" type="hidden" value={job.analysis.id}/><Button type="submit">Opnieuw proberen</Button></form> : null}
                    <Modal
                      title={`Analysetaak - ${job.fortigate.hostname ?? "FortiGate"}`}
                      description={`Veilige live voortgang voor configuratie ${job.analysis.configSha256.slice(0, 12)}. Configuratie-inhoud en Foundry-bodies worden niet gelogd.`}
                      size="wide"
                      trigger={<Button variant="secondary">Live log ({job.events.length || 1})</Button>}
                    >
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <AnalysisJobBadge status={job.status}/>
                        <span className="font-mono text-xs text-muted-foreground">Job {job.id}</span>
                        <span className="text-xs text-muted-foreground">Poging {job.attempts}</span>
                      </div>
                      <ol className="grid gap-3 rounded-lg border border-border bg-surface-soft p-4">
                        {job.events.length ? job.events.map((event) => <li key={event.id} className="border-l-2 border-primary/35 pl-3">
                          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[0.68rem] font-semibold text-muted-foreground">{event.stage}</span><time className="font-mono text-[0.68rem] text-muted-foreground">{formatDateTime(event.createdAt, timeZone)}</time></div>
                          <p className="mt-1 text-xs leading-5">{event.message}</p>
                        </li>) : <li className="text-xs text-muted-foreground">Taak aangemaakt op {formatDateTime(job.createdAt, timeZone)} en wacht op verwerking.</li>}
                      </ol>
                      {job.errorCode ? <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{analysisErrorLabel(job.errorCode)}</div> : null}
                    </Modal>
                  </div>
                </td>
              </tr>;
            }) : <tr className="border-t border-border"><td className="py-10 text-center text-muted-foreground" colSpan={7}>Er zijn geen actieve of recent voltooide analysetaken.</td></tr>}
          </tbody>
        </table>
      </TableShell>
    </section>

    <section className="mt-8 grid gap-3">
      <h2 className="font-display text-xl font-semibold">Backuptaken</h2>
      <TableShell><table className="table-pro w-full min-w-[920px] text-left text-sm"><thead className="bg-surface-soft"><tr><th>FortiGate</th><th>Klant</th><th>Type</th><th>Status</th><th>Beschikbaar</th><th>Pogingen</th><th><span className="sr-only">Actie</span></th></tr></thead><tbody>
        {jobs.length ? jobs.map((job) => <tr className="border-t border-border" key={job.id}>
          <td><span className="flex items-center gap-2 font-semibold"><Icon name="device" className="text-muted-foreground"/>{job.fortigate.hostname ?? job.fortigate.managementUrl}</span>{job.error ? <p className="mt-1 max-w-sm text-xs text-danger">{job.error}</p> : null}</td>
          <td>{job.fortigate.customer.name}</td><td>{job.trigger === BackupJobTrigger.MANUAL ? "Handmatig" : "Scheduler"}</td><td><BackupJobBadge status={job.status}/></td>
          <td className="font-mono text-xs">{formatDateTime(job.availableAt, timeZone)}</td><td className="font-mono">{job.attempts}</td>
          <td>{job.status === BackupJobStatus.PENDING ? <div className="flex gap-2"><form action={runQueuedBackupNowAction}><input name="id" type="hidden" value={job.id}/><Button type="submit">Nu uitvoeren</Button></form><form action={cancelQueuedBackupAction}><input name="id" type="hidden" value={job.id}/><Button type="submit" variant="danger">Annuleren</Button></form></div> : job.status === BackupJobStatus.FAILED ? <form action={retryFailedBackupAction}><input name="id" type="hidden" value={job.id}/><Button type="submit">Opnieuw proberen</Button></form> : <span className="text-xs text-muted-foreground">Wordt verwerkt</span>}</td>
        </tr>) : <tr className="border-t border-border"><td className="py-10 text-center text-muted-foreground" colSpan={7}>De backupqueue is leeg.</td></tr>}
      </tbody></table></TableShell>
    </section>
  </Shell>;
}

function BackupJobBadge({ status }: { status: BackupJobStatus }) {
  if (status === BackupJobStatus.RUNNING) return <Badge tone="warning">Bezig</Badge>;
  if (status === BackupJobStatus.FAILED) return <Badge tone="danger">Mislukt</Badge>;
  return <Badge>Wachtend</Badge>;
}

function AnalysisJobBadge({ status }: { status: SecurityAnalysisJobStatus }) {
  if (status === SecurityAnalysisJobStatus.COMPLETED) return <Badge tone="success">Voltooid</Badge>;
  if (status === SecurityAnalysisJobStatus.FAILED || status === SecurityAnalysisJobStatus.BLOCKED) return <Badge tone="danger">{status === SecurityAnalysisJobStatus.BLOCKED ? "Geblokkeerd" : "Mislukt"}</Badge>;
  if (status === SecurityAnalysisJobStatus.RUNNING) return <Badge tone="warning">Bezig</Badge>;
  return <Badge>Wachtend</Badge>;
}

function analysisErrorLabel(code: string) {
  const labels: Record<string, string> = {
    FOUNDRY_AUTH_INVALID: "Foundry-authenticatie geweigerd",
    REPORTING_NOT_CONFIGURED: "Rapportage niet geconfigureerd",
    SENSITIVE_DATA_DETECTED: "Geblokkeerd door veilige egresscontrole",
    ARTIFACT_INTEGRITY_FAILED: "Configuratie-integriteit mislukt"
  };
  return labels[code] ?? "Gesanitiseerde technische fout";
}
