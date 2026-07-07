import { notFound } from "next/navigation";
import { deleteCustomer, updateCustomer } from "@/app/actions";
import { FirmwareStatus } from "@/components/firmware-status";
import { Modal } from "@/components/modal";
import { ActionLink, Badge, Button, Card, Field, PageHeader, Shell, TableShell } from "@/components/ui";
import { assertTenantAccess, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/time";
import { getTenantTimeZone } from "@/lib/tenant-timezone";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireTenantUser();
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      tenant: true,
      devices: {
        include: {
          backups: { orderBy: { createdAt: "desc" }, take: 10 },
          logs: { orderBy: { createdAt: "desc" }, take: 3 }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });
  if (!customer) notFound();
  assertTenantAccess(user, customer.tenantId);
  const [canCreateFortiGate, canUpdateCustomer, canDeleteCustomer] = await Promise.all([
    hasPermission(user, "fortigates.create"),
    hasPermission(user, "customers.update"),
    hasPermission(user, "customers.delete")
  ]);
  const backups = customer.devices.flatMap((device) =>
    device.backups.map((backup) => ({ ...backup, device }))
  );
  const changedBackups = backups.filter((backup) => backup.filename);
  const latestBackup = backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const timeZone = await getTenantTimeZone(customer.tenantId);

  return (
    <Shell>
      <PageHeader
        title={customer.name}
        description={`${customer.tenant.name} - ${customer.email ?? customer.contact ?? "Geen contactgegevens"}`}
        actions={
          <>
            <ActionLink href="/customers">Klanten</ActionLink>
            {canUpdateCustomer ? (
              <Modal
                title="Klant bewerken"
                description="Werk klantgegevens en integratiekoppelingen bij."
                trigger={<Button variant="secondary">Klant bewerken</Button>}
              >
                <form action={updateCustomer} className="grid gap-4">
                  <input type="hidden" name="id" value={customer.id} />
                  <Field label="Naam" name="name" defaultValue={customer.name} required />
                  <Field label="Contactpersoon" name="contact" defaultValue={customer.contact ?? ""} />
                  <Field label="E-mail" name="email" type="email" defaultValue={customer.email ?? ""} />
                  <Field label="Telefoon" name="phone" defaultValue={customer.phone ?? ""} />
                  <Field label="IT Glue organization ID" name="itGlueOrganizationId" defaultValue={customer.itGlueOrganizationId ?? ""} />
                  <Field label="Autotask Company ID" name="autotaskCompanyId" defaultValue={customer.autotaskCompanyId ?? ""} />
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Notities</span>
                    <textarea
                      className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                      name="notes"
                      defaultValue={customer.notes ?? ""}
                    />
                  </label>
                  <Button>Opslaan</Button>
                </form>
              </Modal>
            ) : null}
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
                      Hiermee verdwijnen {customer.devices.length} FortiGates, {backups.length} backuprecords
                      en alle opgeslagen configuratiebestanden voor deze klant.
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

      <div className="mt-6 grid gap-4 md:grid-cols-6">
        <Card title="FortiGates" value={customer.devices.length} detail="Bij deze klant" />
        <Card title="Backups" value={backups.length} detail="Laatste records" />
        <Card title="Downloadbaar" value={changedBackups.length} detail="Opgeslagen configbestanden" />
        <Card title="IT Glue" value={customer.itGlueOrganizationId ? "Gekoppeld" : "Niet gekoppeld"} detail={customer.itGlueOrganizationId ? `Org ${customer.itGlueOrganizationId}` : "Geen organization ID"} />
        <Card title="Autotask" value={customer.autotaskCompanyId ? "Gekoppeld" : "Niet gekoppeld"} detail={customer.autotaskCompanyId ? `Company ${customer.autotaskCompanyId}` : "Geen company ID"} />
        <Card
          title="Laatste backup"
          value={latestBackup?.status ?? "-"}
          detail={latestBackup ? formatDateTime(latestBackup.createdAt, timeZone) : "Nog niet uitgevoerd"}
        />
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">FortiGates</h2>
        <TableShell className="mt-4">
          <table className="table-pro w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                <th className="px-3 py-2">FortiGate</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Firmware</th>
                <th className="px-3 py-2">TLS verify</th>
                <th className="px-3 py-2">IT Glue</th>
                <th className="px-3 py-2">Laatste log</th>
                <th className="px-3 py-2">Acties</th>
              </tr>
            </thead>
            <tbody>
              {customer.devices.map((device) => {
                const latestLog = device.logs[0];
                return (
                  <tr key={device.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{device.hostname ?? device.managementUrl}</div>
                      <div className="text-xs text-muted-foreground">{device.managementUrl}:{device.httpsPort}</div>
                    </td>
                    <td className="px-3 py-2">{device.model ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="grid gap-2">
                        <span>{[device.firmwareVersion, device.firmwareBuild].filter(Boolean).join(" ") || "-"}</span>
                        <FirmwareStatus version={device.firmwareVersion} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={device.tlsVerify ? "warning" : "success"}>
                        {device.tlsVerify ? "Aan" : "Uit"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {device.itGlueConfigurationId ? <Badge tone="success">Config {device.itGlueConfigurationId}</Badge> : <Badge>Niet gekoppeld</Badge>}
                    </td>
                    <td className="max-w-[360px] px-3 py-2">
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
                    </td>
                    <td className="flex flex-wrap gap-2 px-3 py-2">
                      <ActionLink href={`/customers/${customer.id}/fortigates/${device.id}`} variant="secondary">Open</ActionLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </section>

    </Shell>
  );
}
