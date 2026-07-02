import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { assertOperationalTenant, assertPermission, requireTenantUser, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { customerSchema } from "@/lib/validators";

export async function GET() {
  const user = await requireTenantUser();
  const customers = await prisma.customer.findMany({
    where: { tenantId: tenantFilter(user) ?? "" },
    include: { tenant: true, devices: true },
    orderBy: { name: "asc" }
  });
  return NextResponse.json(customers);
}

export async function POST(request: NextRequest) {
  const user = await requireTenantUser();
  const data = customerSchema.parse(await request.json());
  await assertOperationalTenant(user, data.tenantId);
  await assertPermission(user, "customers.create");
  const customer = await prisma.customer.create({ data });
  await auditLog({
    action: "customer.created",
    tenantId: customer.tenantId,
    entity: "Customer",
    entityId: customer.id
  });
  return NextResponse.json(customer, { status: 201 });
}
