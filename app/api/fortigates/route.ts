import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { assertTenantAccess, isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { fortigateSchema } from "@/lib/validators";

export async function GET() {
  const user = await requireTenantUser();
  const devices = await prisma.fortiGate.findMany({
    where: isSuperAdmin(user) ? {} : { customer: { tenantId: user.tenantId ?? "" } },
    include: { customer: true, backups: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json(devices);
}

export async function POST(request: NextRequest) {
  const user = await requireTenantUser();
  const data = fortigateSchema.parse(await request.json());
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: data.customerId } });
  assertTenantAccess(user, customer.tenantId);
  const device = await prisma.fortiGate.create({
    data: {
      customerId: data.customerId,
      managementUrl: data.managementUrl,
      httpsPort: data.httpsPort,
      apiTokenEncrypted: encryptSecret(data.apiToken),
      tlsVerify: data.tlsVerify,
      vdom: data.vdom,
      scheduleType: data.scheduleType,
      cronExpression: data.cronExpression
    },
    include: { customer: true }
  });
  await auditLog({
    action: "fortigate.created",
    tenantId: device.customer.tenantId,
    entity: "FortiGate",
    entityId: device.id
  });
  return NextResponse.json(device, { status: 201 });
}
