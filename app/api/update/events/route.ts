import { NextRequest, NextResponse } from "next/server";
import { getUpdateRuntimeStatus, readUpdateLog } from "@/lib/app-update";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const pollIntervalMs = 1000;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (request.nextUrl.searchParams.get("poll") === "1") {
    return NextResponse.json(await clientSnapshot(user.id), {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the connection.
        }
      };

      const send = async () => {
        if (closed) return;
        try {
          const snapshot = await clientSnapshot(user.id);
          controller.enqueue(sse(snapshot.running ? "snapshot" : "done", snapshot));
        } catch {
          controller.enqueue(sse("status-error", { retry: true }));
        }
        if (!closed) timer = setTimeout(() => void send(), pollIntervalMs);
      };

      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(`retry: ${pollIntervalMs}\n\n`));
      void send();
    },
    cancel() {
      // request.signal performs the timer cleanup.
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

async function clientSnapshot(userId: string) {
  const status = await getUpdateRuntimeStatus();
  const isStarter = status.startedByUserId === userId;
  return {
    source: "application" as const,
    running: status.running,
    done: !status.running,
    outcome: status.outcome,
    operation: status.operation,
    startedAt: status.startedAt,
    finishedAt: status.finishedAt,
    isStarter,
    returnTo: isStarter ? status.returnTo : "/",
    log: isStarter && status.running ? await readUpdateLog(400) : null
  };
}

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
