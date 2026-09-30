import {
  ObsBusyError,
  ObsError,
  applyOutput,
  getSavedBitrate,
  markEncoderLog,
  restartStream,
  setSourceUrl,
  switchToWhip,
  waitForEncoderStart,
  withObs,
} from "@/lib/obs";
import { INGEST } from "@/lib/config";
import { getObsPayload } from "@/lib/payloads";
import { ObsLaunchError, launchObs } from "@/lib/obs-launch";
import { parseOutputPatch } from "@/lib/shared";
const URL_SCHEMES = ["rtsp:", "rtsps:", "rtmp:", "rtmps:", "http:", "https:", "srt:", "udp:", "rtp:"];

function fail(e: unknown) {
  const message = (e as Error).message;
  return Response.json({ error: message }, { status: e instanceof ObsBusyError ? 409 : e instanceof ObsError ? 502 : 500 });
}

export async function GET() {
  return Response.json(await getObsPayload());
}

type Body =
  | { action: "set-source-url"; input: string; url: string }
  | { action: "apply-output"; bitrate?: number; preset?: string; fps?: { num: number; den: number } }
  | { action: "restart-stream" }
  | { action: "use-whip" }
  | { action: "launch" };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Body>;

  switch (body.action) {
    case "set-source-url": {
      const { input, url } = body as Extract<Body, { action: "set-source-url" }>;
      let parsed: URL;
      try {
        parsed = new URL(String(url).trim());
      } catch {
        return Response.json({ error: "Enter a full URL, e.g. rtsp://192.168.1.10:554/stream" }, { status: 400 });
      }
      if (!URL_SCHEMES.includes(parsed.protocol)) {
        return Response.json({ error: `Unsupported URL scheme ${parsed.protocol}` }, { status: 400 });
      }
      if (typeof input !== "string" || !input) return Response.json({ error: "Missing source" }, { status: 400 });
      try {
        await withObs((obs) => setSourceUrl(obs, input, String(url).trim()));
      } catch (e) {
        return fail(e);
      }
      break;
    }
    case "apply-output": {
      const parsed = parseOutputPatch(body as Record<string, unknown>);
      if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
      const { patch } = parsed;
      let restarted: boolean;
      let savedBitrate: number | null;
      let effectiveBitrate: number | null = null;
      try {
        const mark = await markEncoderLog();
        [restarted, savedBitrate] = await withObs(async (obs) => {
          const r = await applyOutput(obs, patch);
          return [r, await getSavedBitrate(obs)] as const;
        });
        if (restarted && patch.bitrate !== undefined) effectiveBitrate = await waitForEncoderStart(mark);
      } catch (e) {
        return fail(e);
      }
      // Report what OBS actually started with and what the profile now holds, so a
      // silently ignored or overwritten setting is visible.
      return Response.json({ ok: true, restarted, savedBitrate, effectiveBitrate });
    }
    case "restart-stream":
      try {
        await withObs(restartStream);
      } catch (e) {
        return fail(e);
      }
      break;
    case "use-whip":
      if (INGEST !== "whip") return Response.json({ error: "The panel is in RTMP ingest mode" }, { status: 400 });
      try {
        await withObs(switchToWhip);
      } catch (e) {
        return fail(e);
      }
      break;
    case "launch":
      try {
        await launchObs({ startStreaming: false });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: e instanceof ObsLaunchError ? 409 : 500 });
      }
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
