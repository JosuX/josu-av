import { supervisor } from "@/lib/supervisor";

/** Body: { "bitrate": 4500 } — apply it live through the OBS script. */
export async function POST(req: Request) {
  const { bitrate } = ((await req.json().catch(() => ({}))) ?? {}) as { bitrate?: unknown };
  if (typeof bitrate !== "number") return Response.json({ error: "bitrate must be a number" }, { status: 400 });
  try {
    await supervisor.setLiveBitrate(bitrate);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
  return Response.json({ ok: true });
}
