import { NextRequest, NextResponse } from "next/server";
import { assertOperationalTenant, assertPermission, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { runBackup } from "@/lib/fortigate";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await requireTenantUser();
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  await assertOperationalTenant(user, device.customer.tenantId);
  await assertPermission(user, "fortigates.backup.run");
  const backup = await runBackup(id);
  return NextResponse.json(backup);
}
