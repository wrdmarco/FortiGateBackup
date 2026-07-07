import { NextRequest, NextResponse } from "next/server";
import { breakGlassCookieName, breakGlassCookieOptions, sessionCookieName, sessionCookieOptions } from "@/lib/session-cookie";

const publicPaths = ["/login", "/setup", "/api/health", "/api/break-glass/settings"];
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const breakGlassAllowedPaths = ["/settings", "/api/events", "/api/update/events"];

function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function requestHosts(request: NextRequest) {
  const forwardedHosts =
    request.headers
      .get("x-forwarded-host")
      ?.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean) ?? [];
  return new Set([
    request.nextUrl.host.toLowerCase(),
    request.headers.get("host")?.toLowerCase(),
    ...forwardedHosts
  ].filter(Boolean));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (unsafeMethods.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (!requestHosts(request).has(new URL(origin).host.toLowerCase())) {
          return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
      }
    }
  }
  if (
    isPublicPath(pathname) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const sessionToken = request.cookies.get(sessionCookieName)?.value;
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const isBreakGlassSession = request.cookies.get(breakGlassCookieName)?.value === "1";
  if (isBreakGlassSession && !breakGlassAllowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.redirect(new URL("/settings?tab=sso", request.url));
  }
  const response = NextResponse.next();
  response.cookies.set(sessionCookieName, sessionToken, sessionCookieOptions());
  if (isBreakGlassSession) response.cookies.set(breakGlassCookieName, "1", breakGlassCookieOptions());
  return response;
}

export const config = {
  matcher: ["/((?!.*\\.).*)"]
};
