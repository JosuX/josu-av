import { ensureViewerPort } from "@/lib/viewer-port";
import { getWatch } from "@/lib/payloads";

// Public: served on the viewer port too.
export async function GET() {
  ensureViewerPort();
  return Response.json(await getWatch());
}
