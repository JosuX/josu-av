// Start the automation supervisor when the server boots, so it runs without a browser open.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { supervisor } = await import("./lib/supervisor");
    supervisor.ensureRunning();
  }
}
