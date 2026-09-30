import { supervisor } from "@/lib/supervisor";
import { parseAutomationPatch } from "@/lib/shared";

export async function GET() {
  supervisor.ensureRunning();
  return Response.json(supervisor.payload());
}

/** Body: the settings to change, e.g. { "keepStreamLive": true }. */
export async function POST(req: Request) {
  const parsed = parseAutomationPatch(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    await supervisor.update(parsed.patch);
  } catch (e) {
    return Response.json({ error: `Could not save settings: ${(e as Error).message}` }, { status: 500 });
  }
  return Response.json(supervisor.payload());
}
