import { procman } from "@/lib/procman";
import { isProcName } from "@/lib/config";

type Action = "start" | "stop" | "restart" | "kill-external" | "clear-logs";

export async function POST(req: Request, ctx: RouteContext<"/api/process/[name]">) {
  const { name } = await ctx.params;
  if (!isProcName(name)) return Response.json({ error: "unknown process" }, { status: 404 });

  const { action } = (await req.json().catch(() => ({}))) as { action?: Action };
  const proc = procman.get(name);

  switch (action) {
    case "start": {
      const external = await procman.findExternal(name);
      if (external.length) {
        return Response.json(
          { error: `${name} is already running outside this app (pid ${external.join(", ")}). Stop it first.` },
          { status: 409 },
        );
      }
      proc.start();
      break;
    }
    case "stop":
      await proc.stop();
      break;
    case "restart":
      await proc.restart();
      break;
    case "kill-external":
      await procman.killExternal(name);
      break;
    case "clear-logs":
      proc.clearLogs();
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
