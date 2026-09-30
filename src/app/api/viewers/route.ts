import { viewers } from "@/lib/viewers";
import type { ViewerReport } from "@/lib/shared";

const COUNTERS = ["packetsLost", "packetsReceived", "framesDecoded", "framesDropped", "freezeSec", "bytesReceived"] as const;
const OPTIONAL = ["fps", "width", "height"] as const;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Playback stats from a dashboard player; see VideoFeed. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.id !== "string" ||
    b.id.length > 64 ||
    typeof b.label !== "string" ||
    typeof b.hidden !== "boolean" ||
    !COUNTERS.every((k) => isCount(b[k])) ||
    !OPTIONAL.every((k) => b[k] === null || isCount(b[k]))
  ) {
    return Response.json({ error: "invalid report" }, { status: 400 });
  }
  viewers.report({ ...(b as unknown as ViewerReport), label: b.label.slice(0, 80) });
  return new Response(null, { status: 204 });
}
