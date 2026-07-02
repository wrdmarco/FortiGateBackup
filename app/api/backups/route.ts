import { NextResponse } from "next/server";
import { requireTenantUser, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await requireTenantUser();
  const backups = await prisma.backup.findMany({
    where: { fortigate: { customer: { tenantId: tenantFilter(user) ?? "" } } },
    include: { fortigate: { include: { customer: true } } },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return NextResponse.json(backups);
}
