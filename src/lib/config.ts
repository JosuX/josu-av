// Commands managed by the control panel. Two ingest modes:
//   whip (default): OBS --WHIP (H.264 + Opus)--> mediamtx /assembly --WHEP--> browser
//   rtmp:           OBS --rtmp--> mediamtx /assembly --ffmpeg (AAC -> Opus)--> /assembly-webrtc --WHEP--> browser

import { homedir } from "node:os";
import path from "node:path";
import { lanInterface } from "./net";

export const IS_WINDOWS = process.platform === "win32";

export type ProcName = "mediamtx" | "ffmpeg";

export interface ProcSpec {
  name: ProcName;
  label: string;
  /** Compact label for tabs and log headers. */
  shortLabel: string;
  description: string;
  bin: string;
  args: string[];
  env?: Record<string, string>;
  /** Signal used for a graceful stop before escalating to SIGKILL. */
  stopSignal: NodeJS.Signals;
  /** Restart automatically when the process exits on its own. */
  autoRestart: boolean;
  /**
   * With autoRestart: double the restart delay after each crash in a row, up to maxDelayMs,
   * and give up after giveUpAfter of them. Unset: fixed delay, never give up.
   */
  watchdog?: { maxDelayMs: number; giveUpAfter: number };
  /** Pattern used to find instances started outside this app (pgrep -f). */
  externalPattern: string;
  /**
   * The same on Windows, which has no pgrep: the executable's image name, and a pattern its
   * command line must match (unset: any instance of the image).
   */
  windowsExternal: { image: string; cmdline?: RegExp };
}

const MEDIAMTX_BIN = process.env.AV_MEDIAMTX_BIN ?? "mediamtx";
/** "C:\tools\mediamtx.exe" → "mediamtx". */
const exeName = (bin: string) => (bin.split(/[\\/]/).pop() ?? bin).replace(/\.exe$/i, "");
/**
 * MediaMTX's config file. Windows has no standard place for it, so there MediaMTX is left to
 * find mediamtx.yml in its working directory (this app's folder) or use its built-in defaults.
 */
const MEDIAMTX_CONFIG = process.env.AV_MEDIAMTX_CONFIG ?? (IS_WINDOWS ? null : "/etc/mediamtx/mediamtx.yml");
const RTSP = process.env.AV_RTSP_BASE ?? "rtsp://127.0.0.1:8554";
export type Ingest = "whip" | "rtmp";
/**
 * How OBS publishes. Over WHIP, OBS already sends Opus, so browsers play the input path
 * directly and FFmpeg is not needed. Over RTMP, FFmpeg re-encodes AAC to Opus.
 */
export const INGEST: Ingest = process.env.AV_INGEST === "rtmp" ? "rtmp" : "whip";
export const INPUT_PATH = process.env.AV_INPUT_PATH ?? "assembly";
export const OUTPUT_PATH = INGEST === "whip" ? INPUT_PATH : (process.env.AV_OUTPUT_PATH ?? "assembly-webrtc");

export const MEDIAMTX_API = process.env.AV_MEDIAMTX_API ?? "http://127.0.0.1:9997";
/** host:port for MediaMTX's apiAddress, from MEDIAMTX_API (MediaMTX needs the port spelled out). */
export function apiListenAddress(url: string) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
}
export const MEDIAMTX_HLS = process.env.AV_MEDIAMTX_HLS ?? "http://127.0.0.1:8888";
/** WebRTC port the browser connects to (on the same host that serves this app). */
export const WEBRTC_PORT = Number(process.env.AV_WEBRTC_PORT ?? 8889);
/**
 * Interfaces MediaMTX offers for WebRTC (comma-separated). Left to itself it offers every one,
 * including Docker bridges and VPNs, and a connection can then pick an address that doesn't
 * work and fail to come up (seen with OBS's WHIP). Default: this machine's LAN interface.
 * AV_WEBRTC_INTERFACES="" offers them all again.
 */
export const WEBRTC_INTERFACES = process.env.AV_WEBRTC_INTERFACES ?? lanInterface()?.name ?? "";

/** Where OBS publishes in WHIP mode (OBS runs on this host). */
export const WHIP_URL = `http://127.0.0.1:${WEBRTC_PORT}/${INPUT_PATH}/whip`;

const FFMPEG_BIN = process.env.AV_FFMPEG_BIN ?? "ffmpeg";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Declaration order is start order ("Start all"); "Stop all" goes in reverse. */
export const PROCS: Record<ProcName, ProcSpec> = {
  mediamtx: {
    name: "mediamtx",
    label: "MediaMTX",
    shortLabel: "MediaMTX",
    description: "RTSP / RTMP / WebRTC media server",
    bin: MEDIAMTX_BIN,
    args: MEDIAMTX_CONFIG ? [MEDIAMTX_CONFIG] : [],
    // Enable the control API (local only) so the panel can see which paths are live,
    // without editing the root-owned config file.
    // The address comes from AV_MEDIAMTX_API so the panel polls the port MediaMTX listens on.
    env: {
      MTX_API: "yes",
      MTX_APIADDRESS: apiListenAddress(MEDIAMTX_API),
      ...(WEBRTC_INTERFACES && { MTX_WEBRTCIPSFROMINTERFACESLIST: WEBRTC_INTERFACES }),
    },
    stopSignal: "SIGTERM",
    // A crashed MediaMTX takes the feed down; bring it back, but stop if it keeps crashing
    // (e.g. a bad config or a port in use), where retrying cannot help.
    autoRestart: true,
    watchdog: { maxDelayMs: 30_000, giveUpAfter: 5 },
    externalPattern: `^(\\S*/)?${exeName(MEDIAMTX_BIN)}( |$)`,
    windowsExternal: { image: `${exeName(MEDIAMTX_BIN)}.exe` },
  },
  ffmpeg: {
    name: "ffmpeg",
    label: "FFmpeg (Opus for WebRTC)",
    shortLabel: "FFmpeg",
    description: "Re-encodes audio to Opus so the stream plays over WebRTC",
    bin: FFMPEG_BIN,
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
    windowsExternal: { image: `${exeName(FFMPEG_BIN)}.exe`, cmdline: new RegExp(`/${escapeRegExp(OUTPUT_PATH)}"?\\s*$`) },
  },
};

/** Processes this panel manages; FFmpeg only takes part in RTMP ingest. */
export const PROC_NAMES = (Object.keys(PROCS) as ProcName[]).filter((n) => n !== "ffmpeg" || INGEST === "rtmp");

/**
 * Spawn children through `setpriv --pdeathsig` so the kernel stops them if this server
 * dies without cleaning up (SIGKILL, crash). Set AV_PDEATHSIG=0 to disable. Linux only.
 */
export const PDEATHSIG = process.env.AV_PDEATHSIG !== "0" && !IS_WINDOWS;

export function isProcName(s: string): s is ProcName {
  return PROC_NAMES.includes(s as ProcName);
}

// OBS runs on this host and is controlled over obs-websocket (Tools → WebSocket Server Settings).
export const OBS_WS_URL = process.env.AV_OBS_WS_URL ?? "ws://127.0.0.1:4455";
/** Falls back to the password stored in OBS's own websocket config when unset. */
export const OBS_WS_PASSWORD = process.env.AV_OBS_WS_PASSWORD;
export const OBS_CONFIG_DIR =
  process.env.AV_OBS_CONFIG_DIR ??
  (IS_WINDOWS
    ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "obs-studio")
    : `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`}/obs-studio`);

/** OBS binary, and extra arguments for when the panel launches it. */
export const OBS_BIN =
  process.env.AV_OBS_BIN ??
  (IS_WINDOWS
    ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "obs-studio", "bin", "64bit", "obs64.exe")
    : "obs");
export const OBS_EXTRA_ARGS = (process.env.AV_OBS_ARGS ?? "").split(/\s+/).filter(Boolean);
/** Process name OBS runs under (pgrep -x; on Windows the image name, e.g. obs64.exe). */
export const OBS_PROCESS = process.env.AV_OBS_PROCESS ?? OBS_BIN.split(/[\\/]/).pop()!;

/** Panel state: automation switches, and the files shared with the OBS live-bitrate script. */
export const STATE_DIR =
  process.env.AV_STATE_DIR ??
  (IS_WINDOWS
    ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "av-control")
    : `${process.env.XDG_STATE_HOME ?? `${process.env.HOME}/.local/state`}/av-control`);

/**
 * Port that serves only the viewer page (/watch) and what it needs, so viewers never reach the
 * controls. "0" turns it off. The panel itself stays on PORT (3000).
 */
export const VIEWER_PORT = Number(process.env.AV_VIEWER_PORT ?? 8080);
