import { NextRequest } from "next/server";
import { getUpdateRuntimeStatus, readUpdateLog } from "@/lib/app-update";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const pollIntervalMs = 1500;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setInterval> | null = null;

      const sendSnapshot = async () => {
        const status = await getUpdateRuntimeStatus();
        const isStarter = status.startedByUserId === user.id;
        const payload = {
          running: status.running,
          done: !status.running,
          returnTo: status.returnTo,
          log: isStarter ? await readUpdateLog(400) : null
        };
        controller.enqueue(sse(status.running ? "snapshot" : "done", payload));
        if (!status.running && !closed) {
          closed = true;
          if (timer) clearInterval(timer);
          controller.close();
        }
      };

      await sendSnapshot();
      if (closed) return;
      timer = setInterval(async () => {
        try {
          await sendSnapshot();
        } catch (error) {
          controller.enqueue(sse("error", { message: error instanceof Error ? error.message : "Update log kon niet worden gelezen." }));
        }
      }, pollIntervalMs);

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (timer) clearInterval(timer);
        controller.close();
      });
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

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
