// Commands managed by the control panel. Mirrors the setup that was running by hand:
//   OBS --rtmp--> mediamtx /assembly --ffmpeg (AAC -> Opus)--> /assembly-webrtc (WebRTC/WHEP)

export type ProcName = "mediamtx" | "ffmpeg";

export interface ProcSpec {
  name: ProcName;
  label: string;
  bin: string;
  args: string[];
  env?: Record<string, string>;
  /** Signal used for a graceful stop before escalating to SIGKILL. */
  stopSignal: NodeJS.Signals;
  /** Restart automatically when the process exits on its own. */
  autoRestart: boolean;
  /** Pattern used to find instances started outside this app (pgrep -f). */
  externalPattern: string;
}

const MEDIAMTX_BIN = process.env.AV_MEDIAMTX_BIN ?? "mediamtx";
const RTSP = process.env.AV_RTSP_BASE ?? "rtsp://127.0.0.1:8554";
export const INPUT_PATH = process.env.AV_INPUT_PATH ?? "assembly";
export const OUTPUT_PATH = process.env.AV_OUTPUT_PATH ?? "assembly-webrtc";

export const MEDIAMTX_API = process.env.AV_MEDIAMTX_API ?? "http://127.0.0.1:9997";
export const MEDIAMTX_HLS = process.env.AV_MEDIAMTX_HLS ?? "http://127.0.0.1:8888";
/** WebRTC port the browser connects to (on the same host that serves this app). */
export const WEBRTC_PORT = Number(process.env.AV_WEBRTC_PORT ?? 8889);

export const PROCS: Record<ProcName, ProcSpec> = {
  mediamtx: {
    name: "mediamtx",
    label: "MediaMTX",
    bin: MEDIAMTX_BIN,
    args: [process.env.AV_MEDIAMTX_CONFIG ?? "/etc/mediamtx/mediamtx.yml"],
    // Enable the control API (local only) so the panel can see which paths are live,
    // without editing the root-owned config file.
    env: { MTX_API: "yes", MTX_APIADDRESS: "127.0.0.1:9997" },
    stopSignal: "SIGTERM",
    autoRestart: false,
    externalPattern: `^(\\S*/)?${MEDIAMTX_BIN.split("/").pop()}( |$)`,
  },
  ffmpeg: {
    name: "ffmpeg",
    label: "FFmpeg (Opus for WebRTC)",
    bin: process.env.AV_FFMPEG_BIN ?? "ffmpeg",
    args: [
      "-hide_banner",
      "-nostdin",
      "-stats_period", "5",
      "-rtsp_transport", "tcp",
      "-i", `${RTSP}/${INPUT_PATH}`,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "copy",
      "-c:a", "libopus",
      "-b:a", "64k",
      "-f", "rtsp",
      `${RTSP}/${OUTPUT_PATH}`,
    ],
    stopSignal: "SIGINT",
    // ffmpeg exits whenever OBS stops publishing; keep retrying until stopped.
    autoRestart: true,
    externalPattern: `^(\\S*/)?ffmpeg .*/${OUTPUT_PATH}$`,
  },
};

export const PROC_NAMES = Object.keys(PROCS) as ProcName[];

export function isProcName(s: string): s is ProcName {
  return s in PROCS;
}
