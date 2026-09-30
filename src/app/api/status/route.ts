import { procman } from "@/lib/procman";
import { supervisor } from "@/lib/supervisor";
import { listPaths, probePathReady } from "@/lib/mediamtx";
import { INGEST, OUTPUT_PATH, INPUT_PATH, WEBRTC_PORT } from "@/lib/config";
import type { StatusPayload } from "@/lib/shared";

export async function GET() {
  supervisor.ensureRunning();
  const [processes, paths] = await Promise.all([procman.status(), listPaths()]);

  let outputReady: boolean;
  let inputReady: boolean | null;
  if (paths) {
    outputReady = paths.some((p) => p.name === OUTPUT_PATH && p.ready);
    inputReady = paths.some((p) => p.name === INPUT_PATH && p.ready);
  } else {
    // API unavailable: only probe when something is plausibly serving the path.
    const mtxUp = processes.some((p) => p.name === "mediamtx" && (p.pid || p.externalPids.length));
    outputReady = mtxUp ? await probePathReady(OUTPUT_PATH) : false;
    inputReady = null;
  }

  return Response.json({
    processes,
    paths,
    warnings: supervisor.warnings,
    stream: { ingest: INGEST, input: INPUT_PATH, output: OUTPUT_PATH, inputReady, outputReady, webrtcPort: WEBRTC_PORT },
  } satisfies StatusPayload);
}
