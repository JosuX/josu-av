import { procman, type LogLine, type ProcState } from "@/lib/procman";
import { onShutdown } from "@/lib/shutdown";
import { isProcName } from "@/lib/config";
import { eventLogs } from "@/lib/eventlog";
import { isEventLogName } from "@/lib/shared";

// Server-Sent Events: backlog first, then live lines, plus state changes for a process.
export async function GET(req: Request, ctx: RouteContext<"/api/logs/[name]">) {
  const { name } = await ctx.params;
  const proc = isProcName(name) ? procman.get(name) : isEventLogName(name) ? eventLogs[name] : null;
  if (!proc) return new Response("unknown log", { status: 404 });
  const state = "state" in proc ? proc.state : null;
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const body = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("backlog", proc.lines);
      if (state) send("state", state);

      const onLine = (l: LogLine) => send("line", l);
      const onState = (s: ProcState) => send("state", s);
      const onClear = () => send("clear", null);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15000);

      proc.on("line", onLine);
      proc.on("state", onState);
      proc.on("clear", onClear);
      cleanup = () => {
        offShutdown();
        clearInterval(ping);
        proc.off("line", onLine);
        proc.off("state", onState);
        proc.off("clear", onClear);
      };
      // Ends the stream when the server stops, so shutdown doesn't wait on it.
      const offShutdown = onShutdown(() => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** Clear an event log (process logs are cleared through /api/process/<name>). */
export async function POST(req: Request, ctx: RouteContext<"/api/logs/[name]">) {
  const { name } = await ctx.params;
  if (!isEventLogName(name)) return Response.json({ error: "unknown log" }, { status: 404 });
  const { action } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: unknown };
  if (action !== "clear") return Response.json({ error: "unknown action" }, { status: 400 });
  eventLogs[name].clearLogs();
  return Response.json({ ok: true });
}
