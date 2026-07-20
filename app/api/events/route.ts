import { NextRequest } from "next/server";
import { getUpdateRuntimeStatus } from "@/lib/app-update";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const pollIntervalMs = 3000;
const maximumSubscribersPerTenant = 50;

type Subscriber = ReadableStreamDefaultController<Uint8Array>;
type TenantWatcher = {
  subscribers: Set<Subscriber>;
  timer: NodeJS.Timeout | null;
  polling: boolean;
  lastVersion: string;
  lastMaintenanceVersion: string;
};

const globalWatchers = globalThis as typeof globalThis & { __fgbpTenantWatchers?: Map<string, TenantWatcher> };
const watchers = (globalWatchers.__fgbpTenantWatchers ??= new Map());

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user?.activeTenantId) return new Response("Unauthorized", { status: 401 });
  const tenantId = user.activeTenantId;
  const existing = watchers.get(tenantId);
  if (existing && existing.subscribers.size >= maximumSubscribersPerTenant) {
    return new Response("Too many realtime connections", { status: 429, headers: { "Retry-After": "10" } });
  }

  let subscriber: Subscriber | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = controller;
      const watcher = watchers.get(tenantId) ?? createWatcher(tenantId);
      watcher.subscribers.add(controller);
      if (watcher.lastVersion) controller.enqueue(sse("ready", watcher.lastVersion));
      request.signal.addEventListener("abort", () => unsubscribe(tenantId, controller), { once: true });
    },
    cancel() {
      if (subscriber) unsubscribe(tenantId, subscriber);
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

function createWatcher(tenantId: string) {
  const watcher: TenantWatcher = {
    subscribers: new Set(),
    timer: null,
    polling: false,
    lastVersion: "",
    lastMaintenanceVersion: ""
  };
  watchers.set(tenantId, watcher);
  void pollWatcher(tenantId, watcher);
  return watcher;
}

async function pollWatcher(tenantId: string, watcher: TenantWatcher) {
  if (watcher.polling || watchers.get(tenantId) !== watcher) return;
  watcher.polling = true;
  try {
    const [version, maintenance] = await Promise.all([tenantDataVersion(tenantId), updateMaintenanceState()]);
    const maintenanceVersion = JSON.stringify(maintenance);
    if (!watcher.lastVersion) broadcast(watcher, "ready", version);
    else if (version !== watcher.lastVersion) broadcast(watcher, "refresh", version);
    if (maintenanceVersion !== watcher.lastMaintenanceVersion) broadcast(watcher, "maintenance", maintenance);
    watcher.lastVersion = version;
    watcher.lastMaintenanceVersion = maintenanceVersion;
    broadcast(watcher, "heartbeat", new Date().toISOString());
  } catch {
    broadcast(watcher, "error", "Realtime gegevens konden tijdelijk niet worden gecontroleerd.");
  } finally {
    watcher.polling = false;
    if (watcher.subscribers.size && watchers.get(tenantId) === watcher) {
      watcher.timer = setTimeout(() => void pollWatcher(tenantId, watcher), pollIntervalMs);
      watcher.timer.unref();
    } else {
      watchers.delete(tenantId);
    }
  }
}

function unsubscribe(tenantId: string, subscriber: Subscriber) {
  const watcher = watchers.get(tenantId);
  if (!watcher) return;
  watcher.subscribers.delete(subscriber);
  if (!watcher.subscribers.size && !watcher.polling) {
    if (watcher.timer) clearTimeout(watcher.timer);
    watchers.delete(tenantId);
  }
}

function broadcast(watcher: TenantWatcher, event: string, data: unknown) {
  const message = sse(event, data);
  for (const subscriber of watcher.subscribers) {
    try {
      subscriber.enqueue(message);
    } catch {
      watcher.subscribers.delete(subscriber);
    }
  }
}

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function tenantDataVersion(tenantId: string) {
  const [tenant, customers, fortigates, backups, jobs, logs, users, roles, settings, audit] = await Promise.all([
    prisma.tenant.aggregate({ where: { id: tenantId }, _max: { updatedAt: true } }),
    prisma.customer.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.fortiGate.aggregate({
      where: { customer: { tenantId } },
      _max: { updatedAt: true, nextRunAt: true, lastCheckedAt: true }
    }),
    prisma.backup.aggregate({ where: { fortigate: { customer: { tenantId } } }, _max: { createdAt: true } }),
    prisma.backupJob.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.fortiGateLog.aggregate({ where: { fortigate: { customer: { tenantId } } }, _max: { createdAt: true } }),
    prisma.user.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.accessRole.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.systemSetting.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.auditLog.aggregate({ where: { tenantId }, _max: { createdAt: true } })
  ]);

  return [
    tenant._max.updatedAt,
    customers._max.updatedAt,
    fortigates._max.updatedAt,
    fortigates._max.nextRunAt,
    fortigates._max.lastCheckedAt,
    backups._max.createdAt,
    jobs._max.updatedAt,
    logs._max.createdAt,
    users._max.updatedAt,
    roles._max.updatedAt,
    settings._max.updatedAt,
    audit._max.createdAt
  ]
    .map(versionPart)
    .join(":");
}

async function updateMaintenanceState() {
  const status = await getUpdateRuntimeStatus();
  return { running: status.running, startedAt: status.startedAt };
}

function versionPart(value: Date | null | undefined) {
  return value ? String(value.getTime()) : "0";
}
