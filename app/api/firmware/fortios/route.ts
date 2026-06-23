import { NextRequest, NextResponse } from "next/server";
import { checkFortiOsFirmware } from "@/lib/firmware-check";
import { requireTenantUser } from "@/lib/authz";

export async function GET(request: NextRequest) {
  await requireTenantUser();
  const version = request.nextUrl.searchParams.get("version");
  const result = await checkFortiOsFirmware(version);
  return NextResponse.json(result);
}
