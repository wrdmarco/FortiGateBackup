import { BackupJobStatus, BackupJobTrigger } from "@prisma/client";
import { cancelQueuedBackupAction, retryFailedBackupAction, runQueuedBackupNowAction } from "@/app/actions";
import { Badge, Button, Card, Icon, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const user = await requirePermission("fortigates.backup.run");
  const tenantId = tenantFilter(user);
  await assertOperationalTenant(user, tenantId ?? null);
  if (!tenantId) throw new Error("De actieve tenantcontext ontbreekt.");
  const timeZone = await getTenantTimeZone(tenantId);
  const jobs = await prisma.backupJob.findMany({
    where: { tenantId, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING, BackupJobStatus.FAILED] } },
    include: { fortigate: { include: { customer: { select: { id: true, name: true } } } } },
    orderBy: [{ status: "asc" }, { availableAt: "asc" }, { createdAt: "desc" }],
    take: 100
  });
  const pending = jobs.filter((job) => job.status === BackupJobStatus.PENDING && job.attempts === 0).length;
  const running = jobs.filter((job) => job.status === BackupJobStatus.RUNNING).length;
  const retrying = jobs.filter((job) => job.status === BackupJobStatus.PENDING && job.attempts > 0).length;
  const failed = jobs.filter((job) => job.status === BackupJobStatus.FAILED).length;

  return <Shell>
    <PageHeader title="Queue" description="Backuptaken die wachten, draaien, opnieuw gepland zijn of handmatig aandacht nodig hebben." />
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card title="Wachtend" value={pending} detail="klaar voor verwerking"/><Card title="Actief" value={running} detail="wordt nu uitgevoerd"/><Card title="Opnieuw gepland" value={retrying} detail="wacht op een automatische poging"/><Card title="Mislukt" value={failed} detail="handmatige retry beschikbaar"/></div>
    <TableShell><table className="table-pro w-full min-w-[920px] text-left text-sm"><thead className="bg-surface-soft"><tr><th>FortiGate</th><th>Klant</th><th>Type</th><th>Status</th><th>Beschikbaar</th><th>Pogingen</th><th><span className="sr-only">Actie</span></th></tr></thead><tbody>
      {jobs.length ? jobs.map((job) => <tr className="border-t border-border" key={job.id}>
        <td><span className="flex items-center gap-2 font-semibold"><Icon name="device" className="text-muted-foreground"/>{job.fortigate.hostname ?? job.fortigate.managementUrl}</span>{job.error ? <p className="mt-1 max-w-sm text-xs text-danger">{job.error}</p> : null}</td>
        <td>{job.fortigate.customer.name}</td><td>{job.trigger === BackupJobTrigger.MANUAL ? "Handmatig" : "Scheduler"}</td><td><JobBadge status={job.status}/></td>
        <td className="font-mono text-xs">{formatDateTime(job.availableAt, timeZone)}</td><td className="font-mono">{job.attempts}</td>
        <td>{job.status === BackupJobStatus.PENDING ? <div className="flex gap-2"><form action={runQueuedBackupNowAction}><input name="id" type="hidden" value={job.id}/><Button type="submit">Nu uitvoeren</Button></form><form action={cancelQueuedBackupAction}><input name="id" type="hidden" value={job.id}/><Button type="submit" variant="danger">Annuleren</Button></form></div> : job.status === BackupJobStatus.FAILED ? <form action={retryFailedBackupAction}><input name="id" type="hidden" value={job.id}/><Button type="submit">Opnieuw proberen</Button></form> : <span className="text-xs text-muted-foreground">Wordt verwerkt</span>}</td>
      </tr>) : <tr className="border-t border-border"><td className="py-10 text-center text-muted-foreground" colSpan={7}>De queue is leeg. Nieuwe handmatige en geplande backuptaken verschijnen hier automatisch.</td></tr>}
    </tbody></table></TableShell>
  </Shell>;
}

function JobBadge({ status }: { status: BackupJobStatus }) {
  if (status === BackupJobStatus.RUNNING) return <Badge tone="warning">Bezig</Badge>;
  if (status === BackupJobStatus.FAILED) return <Badge tone="danger">Mislukt</Badge>;
  return <Badge>Wachtend</Badge>;
}
