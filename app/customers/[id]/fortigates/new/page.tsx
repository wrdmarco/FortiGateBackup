import { notFound } from "next/navigation";
import { createFortiGateWithState } from "@/app/actions";
import { FortiGateWizard } from "@/components/fortigate-wizard";
import { ActionLink, PageHeader, Shell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isItGlueEnabled } from "@/lib/itglue";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function NewCustomerFortiGatePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("fortigates.create");
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { tenant: true }
  });
  if (!customer) notFound();
  assertTenantAccess(user, customer.tenantId);
  await assertOperationalTenant(user, customer.tenantId);

  const [defaultScheduleType, itGlueEnabled] = await Promise.all([
    getSetting("backup.defaultSchedule", customer.tenantId),
    isItGlueEnabled(customer.tenantId)
  ]);

  return (
    <Shell>
      <PageHeader
        title="FortiGate toevoegen"
        description={`${customer.name} - ${customer.tenant.name}`}
        actions={<ActionLink href={`/customers/${customer.id}`}>Terug naar klant</ActionLink>}
      />
      <FortiGateWizard
        action={createFortiGateWithState}
        customers={[{ id: customer.id, name: customer.name }]}
        defaultCustomerId={customer.id}
        defaultScheduleType={defaultScheduleType ?? "DAILY"}
        itGlueEnabled={itGlueEnabled}
        successHref={`/customers/${customer.id}`}
      />
    </Shell>
  );
}
