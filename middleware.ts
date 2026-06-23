import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session-cookie";

const publicPaths = ["/login", "/setup", "/api/health"];
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  if (!request.cookies.get(sessionCookieName)?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\.).*)"]
};
