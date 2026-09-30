// Start the automation supervisor and the viewer-only port when the server boots, so they run
// without a browser open.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { supervisor } = await import("./lib/supervisor");
    supervisor.ensureRunning();
    const { ensureViewerPort } = await import("./lib/viewer-port");
    ensureViewerPort();
  }
}
