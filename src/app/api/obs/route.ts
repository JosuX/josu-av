import {
  ObsBusyError,
  ObsError,
  getEncoder,
  getSavedBitrate,
  getStreamStatus,
  listNetworkSources,
  markEncoderLog,
  restartStream,
  setBitrate,
  setSourceUrl,
  waitForEncoderStart,
  withObs,
  type ObsPayload,
} from "@/lib/obs";
import { BITRATE_MAX, BITRATE_MIN, isValidBitrate } from "@/lib/shared";
const URL_SCHEMES = ["rtsp:", "rtsps:", "rtmp:", "rtmps:", "http:", "https:", "srt:", "udp:", "rtp:"];

function fail(e: unknown) {
  const message = (e as Error).message;
  return Response.json({ error: message }, { status: e instanceof ObsBusyError ? 409 : e instanceof ObsError ? 502 : 500 });
}

export async function GET() {
  try {
    const [sources, encoder, stream] = await withObs((obs) =>
      Promise.all([listNetworkSources(obs), getEncoder(obs), getStreamStatus(obs)]),
    );
    return Response.json({ connected: true, sources, encoder, stream } satisfies ObsPayload);
  } catch (e) {
    return Response.json({ connected: false, error: (e as Error).message } satisfies ObsPayload);
  }
}

type Body =
  | { action: "set-source-url"; input: string; url: string }
  | { action: "set-bitrate"; bitrate: number; restart?: boolean }
  | { action: "restart-stream" };

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
    case "set-bitrate": {
      const { bitrate, restart } = body as Extract<Body, { action: "set-bitrate" }>;
      if (!isValidBitrate(bitrate)) {
        return Response.json(
          { error: `Bitrate must be a whole number between ${BITRATE_MIN} and ${BITRATE_MAX} kbps` },
          { status: 400 },
        );
      }
      let savedBitrate: number | null;
      let effectiveBitrate: number | null = null;
      try {
        const mark = await markEncoderLog();
        savedBitrate = await withObs(async (obs) => {
          await setBitrate(obs, bitrate);
          if (restart) await restartStream(obs);
          return getSavedBitrate(obs);
        });
        if (restart) effectiveBitrate = await waitForEncoderStart(mark);
      } catch (e) {
        return fail(e);
      }
      // Report what OBS actually started with and what the profile now holds, so a
      // silently ignored or overwritten setting is visible.
      return Response.json({ ok: true, savedBitrate, effectiveBitrate });
    }
    case "restart-stream":
      try {
        await withObs(restartStream);
      } catch (e) {
        return fail(e);
      }
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
