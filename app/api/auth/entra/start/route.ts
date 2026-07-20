import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import {
  cancelEntraLogin,
  checkEntraStartThrottle,
  clearEntraTransactionCookie,
  entraProviderId,
  isValidLoginEmail,
  normalizeEntraEmail,
  recordGenericEntraFailure,
  setEntraTransactionCookie,
  startEntraLogin
} from "@/lib/entra-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginFormPost(request)) {
    await recordGenericEntraFailure("invalid_origin", "initiation");
    return genericLoginError(request);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) {
    await recordGenericEntraFailure("invalid_request", "initiation");
    return genericLoginError(request);
  }

  let email = "";
  try {
    const formData = await request.formData();
    email = normalizeEntraEmail(formData.get("email"));
  } catch {
    await recordGenericEntraFailure("invalid_request", "initiation");
    return genericLoginError(request);
  }

  try {
    const allowed = await checkEntraStartThrottle(email, requestIpAddress(request));
    if (!allowed || !isValidLoginEmail(email)) {
      await recordGenericEntraFailure(allowed ? "invalid_identity" : "rate_limited", "initiation");
      return genericLoginError(request);
    }

    const transaction = await startEntraLogin(email);
    if (!transaction) return genericLoginError(request);

    await setEntraTransactionCookie(transaction.cookieToken);
    try {
      const destination = await signIn(
        entraProviderId,
        { redirect: false, redirectTo: "/" },
        { login_hint: transaction.email, prompt: "select_account" }
      );
      if (!isMicrosoftAuthorizationUrl(destination)) {
        await cancelEntraLogin(transaction, "invalid_authorization_endpoint");
        await clearEntraTransactionCookie();
        return genericLoginError(request);
      }
      return NextResponse.redirect(destination, 303);
    } catch {
      await cancelEntraLogin(transaction, "authorization_start_failed").catch(() => undefined);
      await clearEntraTransactionCookie();
      return genericLoginError(request);
    }
  } catch {
    await recordGenericEntraFailure("initiation_failed", "initiation");
    await clearEntraTransactionCookie().catch(() => undefined);
    return genericLoginError(request);
  }
}

function genericLoginError(request: NextRequest) {
  const destination = new URL("/login", request.url);
  destination.searchParams.set("error", "sso");
  return NextResponse.redirect(destination, 303);
}

function isSameOriginFormPost(request: NextRequest) {
  const requestHosts = new Set(
    [
      request.nextUrl.host,
      request.headers.get("host"),
      ...(request.headers.get("x-forwarded-host")?.split(",") ?? [])
    ]
      .map((host) => host?.trim().toLowerCase())
      .filter((host): host is string => Boolean(host))
  );
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return requestHosts.has(new URL(origin).host.toLowerCase());
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function requestIpAddress(request: NextRequest) {
  return (
    request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ?? request.headers.get("x-real-ip")?.trim() ?? null
  );
}

function isMicrosoftAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "login.microsoftonline.com";
  } catch {
    return false;
  }
}
