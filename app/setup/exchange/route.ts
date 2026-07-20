import { NextRequest, NextResponse } from "next/server";
import {
  exchangeSetupToken,
  setupTokenCookieName,
  setupTokenCookieOptions
} from "@/lib/setup-token";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const rawToken = typeof body?.token === "string" ? body.token : "";
  const exchangedToken = await exchangeSetupToken(rawToken);
  if (!exchangedToken) {
    return NextResponse.json(
      { error: "Deze eenmalige setup-link is ongeldig of verlopen." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const response = NextResponse.json(
    { redirectTo: "/setup" },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set(setupTokenCookieName, exchangedToken, setupTokenCookieOptions());
  return response;
}
