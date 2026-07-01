import { defaultTimeZone, normalizeTimeZone } from "@/lib/time";
import { getSetting } from "@/lib/settings";

export async function getTenantTimeZone(tenantId?: string | null) {
  const tenantTimeZone = tenantId ? await getSetting("ui.timeZone", tenantId) : null;
  const globalTimeZone = tenantTimeZone ? null : await getSetting("ui.timeZone", null);
  return normalizeTimeZone(tenantTimeZone ?? globalTimeZone ?? defaultTimeZone);
}

export async function getTenantTimeZoneMap(tenantIds: Array<string | null | undefined>) {
  const uniqueTenantIds = [...new Set(tenantIds.filter((tenantId): tenantId is string => Boolean(tenantId)))];
  const entries = await Promise.all(uniqueTenantIds.map(async (tenantId) => [tenantId, await getTenantTimeZone(tenantId)] as const));
  return new Map(entries);
}
