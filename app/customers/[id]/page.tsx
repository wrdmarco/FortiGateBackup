import { notFound } from "next/navigation";
import { deleteCustomer } from "@/app/actions";
import { FirmwareStatus } from "@/components/firmware-status";
import { Modal } from "@/components/modal";
import { firstQueryValue, normalizePage, parsePageParam, ServerPagination } from "@/components/server-pagination";
import { ActionLink, Badge, Button, Card, Field, FilterBar, PageHeader, SectionHeading, Shell, TableShell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { customerSecurityOverview } from "@/lib/security/queries";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function CustomerDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("customers.read");
  const { id } = await params;
  const queryParams = await searchParams;
  const query = firstQueryValue(queryParams.q);
  const requestedPage = parsePageParam(queryParams.page);
  const [canReadFortiGates, canReadBackups, canReadLogs, canReadFirmware, canCreateFortiGate, canUpdateCustomer, canDeleteCustomer, canReadSecurity] = await Promise.all([
    hasPermission(user, "fortigates.read"),
    hasPermission(user, "backups.read"),
    hasPermission(user, "fortigates.logs.read"),
    hasPermission(user, "fortigates.firmware.read"),
    hasPermission(user, "fortigates.create"),
    hasPermission(user, "customers.update"),
    hasPermission(user, "customers.delete"),
    hasPermission(user, "security.analyses.read")
  ]);
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { tenant: true }
  });
  if (!customer) notFound();
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);

  const fortigateWhere = {
    customerId: customer.id,
    ...(query
      ? {
          OR: [
            { hostname: { contains: query } },
            { managementUrl: { contains: query } },
            { serialNumber: { contains: query } },
            { model: { contains: query } }
          ]
        }
      : {})
  };
  const totalDevices = canReadFortiGates ? await prisma.fortiGate.count({ where: fortigateWhere }) : 0;
  const page = normalizePage(requestedPage, totalDevices, PAGE_SIZE);
  const devices = canReadFortiGates
    ? await prisma.fortiGate.findMany({
        where: fortigateWhere,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          customerId: true,
          hostname: true,
          managementUrl: true,
          httpsPort: true,
          serialNumber: true,
          model: true,
          firmwareVersion: true,
          firmwareBuild: true,
          tlsVerify: true,
          itGlueConfigurationId: true
        }
      })
    : [];
  const latestLogEntries = canReadLogs
    ? await Promise.all(devices.map(async (device) => [
        device.id,
        await prisma.fortiGateLog.findFirst({
          where: { fortigateId: device.id },
          orderBy: { createdAt: "desc" },
          select: { level: true, event: true, message: true, createdAt: true }
        })
      ] as const))
    : [];
  const latestLogs = new Map(latestLogEntries);
  const [backupCount, storedBackupCount, latestBackup] = canReadBackups
    ? await Promise.all([
        prisma.backup.count({ where: { fortigate: { customerId: customer.id } } }),
        prisma.backup.count({ where: { fortigate: { customerId: customer.id }, filename: { not: null } } }),
        prisma.backup.findFirst({
          where: { fortigate: { customerId: customer.id } },
          orderBy: { createdAt: "desc" },
          select: { status: true, createdAt: true }
        })
      ])
    : [0, 0, null] as const;
  const [timeZone, securityOverview] = await Promise.all([
    getTenantTimeZone(customer.tenantId),
    canReadSecurity ? customerSecurityOverview(customer.tenantId, customer.id) : Promise.resolve(null)
  ]);
  const deviceSecurity = new Map(securityOverview?.devices.map((item) => [item.fortigateId, item]));

  return (
    <Shell>
      <PageHeader
        title={customer.name}
        description={`${customer.tenant.name} - ${customer.email ?? customer.contact ?? "Geen contactgegevens"}`}
        actions={
          <>
            <ActionLink href="/customers">Klanten</ActionLink>
            {canUpdateCustomer ? <ActionLink href={`/customers/${customer.id}/edit`} variant="secondary">Klant bewerken</ActionLink> : null}
            {canCreateFortiGate ? <ActionLink href={`/customers/${customer.id}/fortigates/new`} variant="primary">FortiGate toevoegen</ActionLink> : null}
            {canDeleteCustomer ? (
              <Modal
                title="Klant verwijderen"
                description="Verwijder de klant inclusief FortiGates, backuprecords en opgeslagen configbestanden."
                trigger={<Button variant="danger">Klant verwijderen</Button>}
              >
                <form action={deleteCustomer} className="grid gap-4">
                  <input type="hidden" name="id" value={customer.id} />
                  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                    <p className="font-semibold">Definitieve verwijdering</p>
                    <p className="mt-2">
                      Hiermee verdwijnen deze klant en alle gekoppelde FortiGates, backuprecords en opgeslagen configuratiebestanden.
                    </p>
                  </div>
                  <Field label={`Typ de klantnaam "${customer.name}" ter bevestiging`} name="confirmName" required />
                  <Button variant="danger">Klant definitief verwijderen</Button>
                </form>
              </Modal>
            ) : null}
          </>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canReadFortiGates ? <Card title="FortiGates" value={totalDevices} detail="Bij deze klant" /> : null}
        {canReadBackups ? <Card title="Backups" value={backupCount} detail="Alle backup runs" /> : null}
        {canReadBackups ? <Card title="Downloadbaar" value={storedBackupCount} detail="Opgeslagen configbestanden" /> : null}
        <Card title="IT Glue" value={customer.itGlueOrganizationId ? "Gekoppeld" : "Niet gekoppeld"} detail={customer.itGlueOrganizationId ? `Org ${customer.itGlueOrganizationId}` : "Geen organization ID"} />
        <Card title="Autotask" value={customer.autotaskCompanyId ? "Gekoppeld" : "Niet gekoppeld"} detail={customer.autotaskCompanyId ? `Company ${customer.autotaskCompanyId}` : "Geen company ID"} />
        {canReadBackups ? <Card
          title="Laatste backup"
          value={latestBackup?.status ?? "-"}
          detail={latestBackup ? formatDateTime(latestBackup.createdAt, timeZone) : "Nog niet uitgevoerd"}
        /> : null}
        {canReadSecurity ? <Card title="Gemiddelde score" value={securityOverview?.average ?? "Niet beschikbaar"} detail="Eén actuele score per FortiGate" /> : null}
        {canReadSecurity ? <Card title="Analysedekking" value={`${securityOverview?.coverage.analysed ?? 0} van ${securityOverview?.coverage.total ?? 0}`} detail="Nieuwste gewijzigde configuraties" /> : null}
        {canReadSecurity ? <Card title="Critical / high" value={`${securityOverview?.critical ?? 0} / ${securityOverview?.high ?? 0}`} detail="Actuele bevindingen" /> : null}
      </div>

      {canReadFortiGates ? <section className="mt-8">
        <SectionHeading title="FortiGates" description="Beheer apparaten, firmwarestatus en de laatste operationele meldingen." />
        <FilterBar><form className="flex flex-wrap items-end gap-3" method="get">
          <label className="grid min-w-64 flex-1 gap-1 text-sm">
            <span className="font-medium">Zoeken</span>
            <input
              className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              defaultValue={query}
              name="q"
              placeholder="Hostname, management URL, serienummer of model"
            />
          </label>
          <Button variant="secondary">Zoeken</Button>
          {query ? <ActionLink href={`/customers/${customer.id}`}>Filter wissen</ActionLink> : null}
        </form></FilterBar>
        <TableShell>
          <table className="table-pro w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">FortiGate</th>
                <th className="px-3 py-2">Model</th>
                {canReadFirmware ? <th className="px-3 py-2">Firmware</th> : null}
                <th className="px-3 py-2">TLS</th>
                <th className="px-3 py-2">IT Glue</th>
                {canReadSecurity ? <th className="px-3 py-2">Beveiligingsscore</th> : null}
                {canReadLogs ? <th className="px-3 py-2">Laatste log</th> : null}
                <th className="px-3 py-2">Acties</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const latestLog = latestLogs.get(device.id);
                const security = deviceSecurity.get(device.id);
                const analysis = security?.analysis;
                return (
                  <tr key={device.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{device.hostname ?? device.managementUrl}</div>
                      <div className="text-xs text-muted-foreground">{device.managementUrl}:{device.httpsPort}</div>
                    </td>
                    <td className="px-3 py-2">{device.model ?? "-"}</td>
                    {canReadFirmware ? <td className="px-3 py-2">
                      <div className="grid gap-2">
                        <span>{[device.firmwareVersion, device.firmwareBuild].filter(Boolean).join(" ") || "-"}</span>
                        <FirmwareStatus version={device.firmwareVersion} />
                      </div>
                    </td> : null}
                    <td className="px-3 py-2">
                      <Badge tone="success">Aan</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {device.itGlueConfigurationId ? <Badge tone="success">Config {device.itGlueConfigurationId}</Badge> : <Badge>Niet gekoppeld</Badge>}
                    </td>
                    {canReadSecurity ? <td className="px-3 py-2">
                      {analysis?.status === "COMPLETED" && analysis.score !== null
                        ? <div className="grid gap-1"><Badge tone={analysis.score >= 80 ? "success" : analysis.score >= 60 ? "warning" : "danger"}>{analysis.score} / 100</Badge><span className="text-xs text-muted-foreground">{analysis.criticalCount} critical · {analysis.highCount} high</span></div>
                        : <Badge tone={analysis?.status === "FAILED" || analysis?.status === "BLOCKED" ? "danger" : "warning"}>{securityStatusLabel(analysis?.status, Boolean(security?.backup))}</Badge>}
                    </td> : null}
                    {canReadLogs ? <td className="max-w-[360px] px-3 py-2">
                      {latestLog ? (
                        <div>
                          <div className={latestLog.level === "ERROR" ? "font-medium text-red-700 dark:text-red-300" : "font-medium"}>
                            {latestLog.level} - {latestLog.event}
                          </div>
                          <div className="text-muted-foreground">{latestLog.message}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(latestLog.createdAt, timeZone)}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Geen logs</span>
                      )}
                    </td> : null}
                    <td className="flex flex-wrap gap-2 px-3 py-2">
                      <ActionLink href={`/customers/${customer.id}/fortigates/${device.id}`} variant="secondary">Open</ActionLink>
                    </td>
                  </tr>
                );
              })}
              {!devices.length ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5 + (canReadFirmware ? 1 : 0) + (canReadLogs ? 1 : 0) + (canReadSecurity ? 1 : 0)}>
                    Geen FortiGates gevonden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
        <ServerPagination
          itemLabel="FortiGates"
          page={page}
          pageSize={PAGE_SIZE}
          path={`/customers/${customer.id}`}
          query={{ q: query }}
          totalItems={totalDevices}
        />
      </section>
      : null}
    </Shell>
  );
}

function securityStatusLabel(status: string | undefined, hasChangedBackup: boolean) {
  if (!hasChangedBackup) return "Geen gewijzigde backup";
  if (!status) return "Niet geanalyseerd";
  if (status === "PENDING" || status === "RUNNING") return "Wacht op analyse";
  if (status === "FAILED") return "Analyse mislukt";
  if (status === "BLOCKED") return "Analyse geblokkeerd";
  return status;
}
