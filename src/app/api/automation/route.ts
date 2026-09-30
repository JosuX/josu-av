import { supervisor } from "@/lib/supervisor";
import { AUTOMATION_KEYS, type AutomationSettings } from "@/lib/shared";

export async function GET() {
  supervisor.ensureRunning();
  return Response.json(supervisor.payload());
}

/** Body: the settings to change, e.g. { "keepStreamLive": true }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "expected a JSON object" }, { status: 400 });
  const patch: Partial<AutomationSettings> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(AUTOMATION_KEYS as readonly string[]).includes(k) || typeof v !== "boolean")
      return Response.json({ error: `unknown setting ${k}` }, { status: 400 });
    patch[k as keyof AutomationSettings] = v;
  }
  try {
    await supervisor.update(patch);
  } catch (e) {
    return Response.json({ error: `Could not save settings: ${(e as Error).message}` }, { status: 500 });
  }
  return Response.json(supervisor.payload());
}
