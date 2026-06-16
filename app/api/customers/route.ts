import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { assertTenantAccess, isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { customerSchema } from "@/lib/validators";

export async function GET() {
  const user = await requireTenantUser();
  const customers = await prisma.customer.findMany({
    where: isSuperAdmin(user) ? {} : { tenantId: user.tenantId ?? "" },
    include: { tenant: true, devices: true },
    orderBy: { name: "asc" }
  });
  return NextResponse.json(customers);
}

export async function POST(request: NextRequest) {
  const user = await requireTenantUser();
  const data = customerSchema.parse(await request.json());
  assertTenantAccess(user, data.tenantId);
  const customer = await prisma.customer.create({ data });
  await auditLog({
    action: "customer.created",
    tenantId: customer.tenantId,
    entity: "Customer",
    entityId: customer.id
  });
  return NextResponse.json(customer, { status: 201 });
}
