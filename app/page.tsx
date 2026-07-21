import { BackupStatus } from "@prisma/client";
import Link from "next/link";
import { ActionLink, Badge, Card, Icon, PageHeader, Shell, TableShell } from "@/components/ui";
import { getAppUpdateStatus } from "@/lib/app-update";
import { requireContextPermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { userPermissionKeys } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireContextPermission({ global: "platform.dashboard.read", tenant: "tenant.dashboard.read" });
  const tenantId = tenantFilter(user);
  const isGlobalContext = await isGlobalTenantId(tenantId);
  const permissionKeys = await userPermissionKeys(user);
  const canReadUpdates = isGlobalContext && permissionKeys.has("platform.updates.read");
  const canReadAudit = permissionKeys.has(isGlobalContext ? "platform.audit.read" : "audit.read");
  const canReadAlerts = !isGlobalContext && permissionKeys.has("alerts.read");
  const canReadTenants = isGlobalContext && permissionKeys.has("platform.tenants.read");
  const timeZone = await getTenantTimeZone(tenantId);
  const customerWhere = tenantId && !isGlobalContext ? { tenantId } : { tenantId: "__global_has_no_customers__" };
  const fortigateWhere = tenantId && !isGlobalContext ? { customer: { tenantId } } : { customer: { tenantId: "__global_has_no_fortigates__" } };
  const backupWhere = tenantId && !isGlobalContext ? { fortigate: { customer: { tenantId } } } : { fortigate: { customer: { tenantId: "__global_has_no_backups__" } } };
  // The dashboard is force-dynamic; this rolling window is intentionally evaluated per request.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [tenants, customers, fortigates, activeFortigates, backups, failures, recentBackups, latestAudit, changed, updateStatus] = await Promise.all([
    canReadTenants ? prisma.tenant.count() : Promise.resolve(isGlobalContext ? 0 : 1),
    prisma.customer.count({ where: customerWhere }),
    prisma.fortiGate.count({ where: fortigateWhere }),
    prisma.fortiGate.count({ where: { ...fortigateWhere, active: true } }),
    prisma.backup.count({ where: backupWhere }),
    prisma.backup.count({ where: { ...backupWhere, status: BackupStatus.FAILED, createdAt: { gte: since } } }),
    !isGlobalContext ? prisma.backup.findMany({ where: backupWhere, include: { fortigate: { include: { customer: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    canReadAudit && tenantId ? prisma.auditLog.findMany({ where: { tenantId }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    prisma.backup.count({ where: { ...backupWhere, status: BackupStatus.CHANGED } }),
    canReadUpdates ? getAppUpdateStatus() : Promise.resolve(null)
  ]);

  if (isGlobalContext) {
    return <Shell><PageHeader title="Platformoverzicht" description="Status van tenants, applicatie-updates en het globale auditspoor." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{canReadTenants ? <Card title="Tenants" value={tenants}/> : null}<Card title="Klanten" value={customers}/><Card title="FortiGates" value={fortigates}/>{canReadUpdates ? <Card title="Applicatie" value={updateStatus?.updateAvailable ? "Update beschikbaar" : updateStatus?.currentVersion ?? "Actueel"} detail={updateStatus?.updateRunning ? "Update wordt uitgevoerd" : "GitHub-status gecontroleerd"}/> : null}</div>
      {canReadAudit ? <AuditTable items={latestAudit} timeZone={timeZone}/> : null}</Shell>;
  }

  const completed = Math.max(0, recentBackups.length - recentBackups.filter((backup) => backup.status === BackupStatus.FAILED).length);
  const successRate = recentBackups.length ? (completed / recentBackups.length) * 100 : 100;
  const attention = recentBackups.filter((backup) => backup.status === BackupStatus.FAILED).slice(0, 2);
  const firstName = (user.name ?? user.email).split(/[\s@]/)[0];

  return <Shell>
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-success">Operationeel overzicht</p><h1 className="font-display text-4xl font-semibold tracking-[-0.015em] sm:text-5xl">Goedemorgen, {firstName}</h1><p className="mt-2 text-base leading-6 text-muted-foreground">Je FortiGate-omgeving is {failures ? "bijna volledig" : "volledig"} onder controle.</p></div>
      <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface shadow-panel">
        <HeaderMetric value={fortigates} label="FortiGates" tone="neutral"/><HeaderMetric value={`${successRate.toFixed(1).replace(".", ",")}%`} label="geslaagd" tone="success"/><HeaderMetric value={failures} label="aandacht" tone={failures ? "warning" : "success"}/>
      </div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,.75fr)]">
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-xl font-semibold">Backupketen</h2><p className="mt-0.5 text-sm text-muted-foreground">Van bereikbaar apparaat tot veilig bewaarde configuratie.</p></div><Badge tone={failures ? "warning" : "success"}>{failures ? `${failures} controle${failures === 1 ? "" : "s"} nodig` : "Keten gezond"}</Badge></div>
        <div className="chain-grid grid gap-0 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <ChainStep icon="device" title="Device" value={`${activeFortigates} / ${fortigates}`} detail="actief" state={activeFortigates === fortigates ? "success" : "warning"} />
          <ChainStep icon="database" title="Snapshot" value={backups} detail={`${changed} configuraties gewijzigd`} state={failures ? "warning" : "success"} />
          <ChainStep icon="shield" title="Verificatie" value={`${completed} / ${recentBackups.length}`} detail="recente controles geslaagd" state={failures ? "warning" : "success"} />
          <ChainStep icon="archive" title="Bewaring" value={changed} detail="originele snapshots bewaard" state="success" last />
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border bg-surface-soft/70 px-5 py-3 font-mono text-xs text-muted-foreground"><span className="flex items-center gap-2"><Icon name="clock" className="h-4 w-4"/>Laatste controle: {recentBackups[0] ? formatDateTime(recentBackups[0].createdAt, timeZone) : "nog niet uitgevoerd"}</span><span>Tijdzone: {timeZone}</span></div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="font-display text-xl font-semibold">Nu aandacht nodig</h2>{canReadAlerts ? <ActionLink href="/alerts">Alles bekijken</ActionLink> : null}</div>
        {attention.length ? <div className="divide-y divide-border">{attention.map((backup) => <div className="border-l-4 border-danger px-5 py-4" key={backup.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-50 text-danger dark:bg-red-950"><Icon name="alert" className="h-4 w-4"/></span><div className="min-w-0"><p className="font-semibold">Backup mislukt · {backup.fortigate.hostname ?? backup.fortigate.managementUrl}</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{backup.error ?? "Controleer de verbinding en apparaatstatus."}</p><p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(backup.createdAt, timeZone)}</p></div></div></div>)}</div> : <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-success dark:bg-emerald-950"><Icon name="check"/></span><p className="mt-3 font-semibold">Geen open aandachtspunten</p><p className="mt-1 text-sm text-muted-foreground">De laatste backupcontroles zijn geslaagd.</p></div></div>}
      </section>
    </div>

    <section className="mt-5"><div className="mb-3 flex items-end justify-between"><div><h2 className="font-display text-xl font-semibold">Laatste wijzigingen</h2><p className="mt-1 text-sm text-muted-foreground">De nieuwste configuratiesnapshots binnen deze tenant.</p></div></div><TableShell><table className="table-pro w-full min-w-[760px] text-left text-sm"><thead className="bg-surface-soft"><tr><th>FortiGate</th><th>Klant</th><th>Status</th><th>Firmware</th><th>Laatste controle</th><th><span className="sr-only">Openen</span></th></tr></thead><tbody>{recentBackups.length ? recentBackups.map((backup) => <tr className="border-t border-border" key={backup.id}><td><span className="flex items-center gap-2 font-semibold"><Icon name="device" className="text-muted-foreground"/>{backup.fortigate.hostname ?? backup.fortigate.managementUrl}</span></td><td>{backup.fortigate.customer.name}</td><td><BackupBadge status={backup.status}/></td><td className="font-mono text-xs">{backup.fortigate.firmwareVersion ?? "Onbekend"}{backup.fortigate.firmwareBuild ? ` · ${backup.fortigate.firmwareBuild}` : ""}</td><td className="font-mono text-xs">{formatDateTime(backup.createdAt, timeZone)}</td><td><Link aria-label={`Open ${backup.fortigate.hostname ?? "FortiGate"}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-muted" href={`/customers/${backup.fortigate.customer.id}/fortigates/${backup.fortigate.id}`}><Icon name="arrow"/></Link></td></tr>) : <tr className="border-t border-border"><td className="py-10 text-center text-muted-foreground" colSpan={6}>Nog geen backupresultaten. Voeg een FortiGate toe om de keten te starten.</td></tr>}</tbody></table></TableShell></section>
  </Shell>;
}

function HeaderMetric({ value, label, tone }: { value: string | number; label: string; tone: "neutral" | "success" | "warning" }) { return <div className="min-w-[6.3rem] px-4 py-3 text-center"><p className={tone === "success" ? "font-display text-xl font-bold text-success" : tone === "warning" ? "font-display text-xl font-bold text-warning" : "font-display text-xl font-bold"}>{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></div>; }

function ChainStep({ icon, title, value, detail, state, last = false }: { icon: "device" | "database" | "shield" | "archive"; title: string; value: string | number; detail: string; state: "success" | "warning"; last?: boolean }) { return <div className="relative p-4 text-center"><div className={state === "success" ? "mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-success dark:border-emerald-900 dark:bg-emerald-950" : "mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber-200 bg-amber-50 text-warning dark:border-amber-900 dark:bg-amber-950"}><Icon name={icon}/></div>{!last ? <span className="absolute left-[calc(50%+2.25rem)] top-[2.75rem] hidden h-px w-[calc(100%-4.5rem)] bg-border xl:block"><span className={state === "success" ? "absolute right-0 -top-1 h-2 w-2 rounded-full bg-success" : "absolute right-0 -top-1 h-2 w-2 rounded-full bg-warning"}/></span> : null}<h3 className="mt-3 font-semibold">{title}</h3><p className={state === "success" ? "mt-2 font-mono text-base font-semibold text-success" : "mt-2 font-mono text-base font-semibold text-warning"}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }

function BackupBadge({ status }: { status: BackupStatus }) { if (status === BackupStatus.CHANGED) return <Badge tone="success">Gewijzigd</Badge>; if (status === BackupStatus.FAILED) return <Badge tone="danger">Mislukt</Badge>; return <Badge>Ongewijzigd</Badge>; }

function AuditTable({ items, timeZone }: { items: Array<{ id: string; action: string; entity: string | null; createdAt: Date; user: { name: string | null; email: string } | null }>; timeZone: string }) { return <section className="mt-8"><h2 className="mb-3 font-display text-xl font-semibold">Recente platformactiviteit</h2><TableShell><table className="table-pro w-full text-left text-sm"><thead className="bg-surface-soft"><tr><th>Actie</th><th>Wie</th><th>Entiteit</th><th>Tijd</th></tr></thead><tbody>{items.length ? items.map((item) => <tr key={item.id} className="border-t border-border"><td>{item.action}</td><td>{item.user?.name ?? item.user?.email ?? "Systeem"}</td><td>{item.entity ?? "-"}</td><td>{formatDateTime(item.createdAt, timeZone)}</td></tr>) : <tr className="border-t border-border"><td className="py-8 text-center text-muted-foreground" colSpan={4}>Nog geen globale auditregels.</td></tr>}</tbody></table></TableShell></section>; }
