import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const started = Date.now();
  try {
    const [database]=await prisma.$queryRaw<Array<{version:number;role:string;superuser:boolean;bypassrls:boolean}>>`SELECT current_setting('server_version_num')::int version,current_user role,r.rolsuper superuser,r.rolbypassrls bypassrls FROM pg_roles r WHERE r.rolname=current_user`;
    if(!database||database.version<160000||database.superuser||database.bypassrls)throw new Error("PostgreSQL runtime role voldoet niet aan de beveiligingseisen.");
    return NextResponse.json({
      status: "ok",
      version: "0.2.17",
      database: "ok",
      databaseEngine: "postgresql",
      databaseVersion: database.version,
      latencyMs: Date.now() - started,
      time: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "error",
        message: error instanceof Error ? error.message : "Unknown health error"
      },
      { status: 503 }
    );
  }
}
