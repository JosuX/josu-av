import "server-only";

// Long-lived responses (Server-Sent Events) never finish by themselves, and on SIGTERM Next waits
// for open requests before exiting, so a stop would hang until systemd kills the panel. Streams
// register here and are closed when the server is told to stop.

const g = globalThis as unknown as { __avShutdown?: Set<() => void> };

function hooks() {
  if (!g.__avShutdown) {
    const set = new Set<() => void>();
    const run = () => {
      for (const fn of set) {
        try {
          fn();
        } catch {}
      }
      set.clear();
    };
    process.once("SIGTERM", run);
    process.once("SIGINT", run);
    g.__avShutdown = set;
  }
  return g.__avShutdown;
}

/** Run `fn` when the server starts shutting down; returns an unsubscribe function. */
export function onShutdown(fn: () => void): () => void {
  const set = hooks();
  set.add(fn);
  return () => set.delete(fn);
}
