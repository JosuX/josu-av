// Runs the panel's Next server inside Electron's utility process. On "quit" it exits normally,
// which runs the panel's exit handler and stops MediaMTX and FFmpeg; being killed would not.
process.parentPort?.on("message", (e) => {
  if (e.data === "quit") process.exit(0);
});
require(process.env.AV_SERVER_ENTRY);
