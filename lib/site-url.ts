import { getSetting } from "@/lib/settings";

export function normalizeSiteUrl(value?: string | null) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) return "";
  const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  return url.toString().replace(/\/+$/, "");
}

export async function getTenantSiteUrl(tenantId?: string | null) {
  const tenantUrl = tenantId ? await getSetting("portal.siteUrl", tenantId) : null;
  if (tenantUrl) return normalizeSiteUrl(tenantUrl);
  const globalUrl = await getSetting("portal.siteUrl", null);
  if (globalUrl) return normalizeSiteUrl(globalUrl);
  return normalizeSiteUrl(process.env.SERVER_URL);
}