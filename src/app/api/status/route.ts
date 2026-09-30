import { ensureViewerPort } from "@/lib/viewer-port";
import { supervisor } from "@/lib/supervisor";
import { getStatus } from "@/lib/payloads";

export async function GET() {
  ensureViewerPort();
  supervisor.ensureRunning();
  return Response.json(await getStatus());
}
