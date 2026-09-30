import { ensureViewerPort } from "@/lib/viewer-port";
import { listPaths, probePathReady } from "@/lib/mediamtx";
import { OUTPUT_PATH, WEBRTC_PORT } from "@/lib/config";
import type { WatchPayload } from "@/lib/shared";

// Public: served on the viewer port too, so it tells viewers whether the stream is live and
// nothing else.
export async function GET() {
  ensureViewerPort();
  const paths = await listPaths();
  const live = paths ? paths.some((p) => p.name === OUTPUT_PATH && p.ready) : await probePathReady(OUTPUT_PATH);
  return Response.json({ live, path: OUTPUT_PATH, webrtcPort: WEBRTC_PORT } satisfies WatchPayload);
}
