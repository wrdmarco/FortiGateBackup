import { NextRequest, NextResponse } from "next/server";
import { assertOperationalTenant, requireTenantUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireTenantUser();
  const { id } = await params;
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const take = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
  const device = await prisma.fortiGate.findUniqueOrThrow({
    where: { id },
    include: { customer: true }
  });
  await assertOperationalTenant(user, device.customer.tenantId);
  const logs = await prisma.fortiGateLog.findMany({
    where: { fortigateId: id },
    orderBy: { createdAt: "desc" },
    take
  });
  return NextResponse.json(logs);
}
