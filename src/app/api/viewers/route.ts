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
    (b.source !== "dashboard" && b.source !== "watch page") ||
    !COUNTERS.every((k) => isCount(b[k])) ||
    !OPTIONAL.every((k) => b[k] === null || isCount(b[k]))
  ) {
    return Response.json({ error: "invalid report" }, { status: 400 });
  }
  // The viewer port adds X-Forwarded-For; Next sets it for direct requests too.
  const from = req.headers.get("x-forwarded-for")?.split(",")[0].trim().replace(/^::ffff:/, "") || null;
  viewers.report({ ...(b as unknown as ViewerReport), label: b.label.slice(0, 80) }, Date.now(), from);
  return new Response(null, { status: 204 });
}
