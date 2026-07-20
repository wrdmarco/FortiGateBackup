import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handlers } from "@/auth";
import { expireEntraTransactionCookie, failOutstandingEntraLogin } from "@/lib/entra-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleAuthRequest(request, handlers.GET);
}

export async function POST(request: NextRequest) {
  return handleAuthRequest(request, handlers.POST);
}

async function handleAuthRequest(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>
) {
  const isEntraCallback = request.nextUrl.pathname === "/api/auth/callback/microsoft-entra-id";
  try {
    const response = await handler(request);
    if (!isEntraCallback) return response;

    await failOutstandingEntraLogin(request).catch(() => undefined);
    return expireEntraTransactionCookie(response);
  } catch {
    if (isEntraCallback) {
      await failOutstandingEntraLogin(request).catch(() => undefined);
    }
    return genericLoginError(request, isEntraCallback);
  }
}

function genericLoginError(request: NextRequest, clearTransaction: boolean) {
  const destination = new URL("/login", request.url);
  destination.searchParams.set("error", "sso");
  const response = NextResponse.redirect(destination, 303);
  return clearTransaction ? expireEntraTransactionCookie(response) : response;
}
