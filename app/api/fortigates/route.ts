import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { assertTenantAccess, isSuperAdmin, requireTenantUser } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { fortigateSchema } from "@/lib/validators";

const fortigateSelect = {
  id: true,
  customerId: true,
  hostname: true,
  serialNumber: true,
  model: true,
  firmwareVersion: true,
  firmwareBuild: true,
  uptime: true,
  managementUrl: true,
  httpsPort: true,
  tlsVerify: true,
  vdom: true,
  scheduleType: true,
  cronExpression: true,
  nextRunAt: true,
  lastCheckedAt: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  customer: true,
  backups: { orderBy: { createdAt: "desc" as const }, take: 1 },
  logs: { orderBy: { createdAt: "desc" as const }, take: 5 }
};

export async function GET() {
  const user = await requireTenantUser();
  const devices = await prisma.fortiGate.findMany({
    where: isSuperAdmin(user) ? {} : { customer: { tenantId: user.tenantId ?? "" } },
    select: fortigateSelect,
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
    select: fortigateSelect
  });
  await auditLog({
    action: "fortigate.created",
    tenantId: device.customer.tenantId,
    entity: "FortiGate",
    entityId: device.id
  });
  return NextResponse.json(device, { status: 201 });
}
