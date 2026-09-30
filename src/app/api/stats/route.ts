import { stats, type StatSample } from "@/lib/sysstats";
import { onShutdown } from "@/lib/shutdown";

// Server-Sent Events: recent history, then one sample per second.
export async function GET(req: Request) {
  stats.ensureRunning();
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const body = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("history", stats.history);
      const onSample = (s: StatSample) => send("sample", s);
      stats.on("sample", onSample);
      cleanup = () => {
        offShutdown();
        stats.off("sample", onSample);
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
