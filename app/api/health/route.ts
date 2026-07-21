import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      version: "0.1.15",
      database: "ok",
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
