import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const pollIntervalMs = 3000;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user?.activeTenantId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const tenantId = user.activeTenantId;

  const stream = new ReadableStream({
    async start(controller) {
      let lastVersion = await tenantDataVersion(tenantId);
      controller.enqueue(sse("ready", lastVersion));

      const timer = setInterval(async () => {
        try {
          const nextVersion = await tenantDataVersion(tenantId);
          if (nextVersion !== lastVersion) {
            lastVersion = nextVersion;
            controller.enqueue(sse("refresh", nextVersion));
          } else {
            controller.enqueue(sse("heartbeat", new Date().toISOString()));
          }
        } catch (error) {
          controller.enqueue(sse("error", error instanceof Error ? error.message : "Realtime update check failed."));
        }
      }, pollIntervalMs);

      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function sse(event: string, data: string) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function tenantDataVersion(tenantId: string) {
  const [
    tenant,
    customers,
    fortigates,
    backups,
    logs,
    users,
    roles,
    settings,
    audit
  ] = await Promise.all([
    prisma.tenant.aggregate({
      where: { id: tenantId },
      _max: { updatedAt: true }
    }),
    prisma.customer.aggregate({
      where: { tenantId },
      _max: { updatedAt: true }
    }),
    prisma.fortiGate.aggregate({
      where: { customer: { tenantId } },
      _max: { updatedAt: true, nextRunAt: true, lastCheckedAt: true }
    }),
    prisma.backup.aggregate({
      where: { fortigate: { customer: { tenantId } } },
      _max: { createdAt: true }
    }),
    prisma.fortiGateLog.aggregate({
      where: { fortigate: { customer: { tenantId } } },
      _max: { createdAt: true }
    }),
    prisma.user.aggregate({
      where: { tenantId },
      _max: { updatedAt: true }
    }),
    prisma.accessRole.aggregate({
      where: { tenantId },
      _max: { updatedAt: true }
    }),
    prisma.systemSetting.aggregate({
      where: { tenantId },
      _max: { updatedAt: true }
    }),
    prisma.auditLog.aggregate({
      where: { tenantId },
      _max: { createdAt: true }
    })
  ]);

  return [
    tenant._max.updatedAt,
    customers._max.updatedAt,
    fortigates._max.updatedAt,
    fortigates._max.nextRunAt,
    fortigates._max.lastCheckedAt,
    backups._max.createdAt,
    logs._max.createdAt,
    users._max.updatedAt,
    roles._max.updatedAt,
    settings._max.updatedAt,
    audit._max.createdAt
  ].map((value) => value?.getTime() ?? 0).join(":");
}
