import { procman, type LogLine, type ProcState } from "@/lib/procman";
import { isProcName } from "@/lib/config";

// Server-Sent Events: backlog first, then live lines and state changes.
export async function GET(req: Request, ctx: RouteContext<"/api/logs/[name]">) {
  const { name } = await ctx.params;
  if (!isProcName(name)) return new Response("unknown process", { status: 404 });
  const proc = procman.get(name);
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const body = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("backlog", proc.lines);
      send("state", proc.state);

      const onLine = (l: LogLine) => send("line", l);
      const onState = (s: ProcState) => send("state", s);
      const onClear = () => send("clear", null);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15000);

      proc.on("line", onLine);
      proc.on("state", onState);
      proc.on("clear", onClear);
      cleanup = () => {
        clearInterval(ping);
        proc.off("line", onLine);
        proc.off("state", onState);
        proc.off("clear", onClear);
      };
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
