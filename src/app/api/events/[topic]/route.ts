import { isTopic, live } from "@/lib/live";
import { onShutdown } from "@/lib/shutdown";
import { supervisor } from "@/lib/supervisor";

// Server-Sent Events: the topic's latest payload, then each change ("data" events).
export async function GET(req: Request, ctx: RouteContext<"/api/events/[topic]">) {
  const { topic } = await ctx.params;
  if (!isTopic(topic)) return new Response("unknown topic", { status: 404 });
  supervisor.ensureRunning();
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const body = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = live[topic].subscribe((json) => write(`event: data\ndata: ${json}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), 15000);
      cleanup = () => {
        offShutdown();
        clearInterval(ping);
        unsubscribe();
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
