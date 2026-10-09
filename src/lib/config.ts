import { existsSync } from "node:fs";
import path from "node:path";

// Commands managed by the control panel. Mirrors the setup that was running by hand:
//   OBS --rtmp--> mediamtx /assembly --ffmpeg (AAC -> Opus)--> /assembly-webrtc (WebRTC/WHEP)

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
   * Pattern matched against full command lines to find instances started outside this app
   * (pgrep -f on Linux; case-insensitively against Win32_Process.CommandLine on Windows).
   */
  externalPattern: string;
}

/** Full path of `bin` if it is on PATH (or is itself a path to an existing file). */
function findOnPath(bin: string): string | null {
  if (/[\\/]/.test(bin)) return existsSync(bin) ? bin : null;
  const exts = IS_WINDOWS ? ["", ...(process.env.PATHEXT ?? ".EXE").split(";")] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, bin + ext);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

/** Matches a command line whose program is `bin`, with or without directory, quotes or .exe. */
function programPattern(bin: string, rest: string): string {
  if (!IS_WINDOWS) return `^(\\S*/)?${bin.split("/").pop()}${rest}`;
  const base = path.basename(bin).replace(/\.exe$/i, "");
  return `^"?([^"]*[\\\\/])?${base}(\\.exe)?"?${rest}`;
}

const MEDIAMTX_BIN = process.env.AV_MEDIAMTX_BIN ?? "mediamtx";
const FFMPEG_BIN = process.env.AV_FFMPEG_BIN ?? "ffmpeg";

/** Linux packages install the config in /etc; on Windows (winget, release zip) it sits next to mediamtx.exe. */
function defaultMediamtxConfig(): string {
  if (!IS_WINDOWS) return "/etc/mediamtx/mediamtx.yml";
  const exe = findOnPath(MEDIAMTX_BIN);
  return exe ? path.join(path.dirname(exe), "mediamtx.yml") : "mediamtx.yml";
}

const RTSP = process.env.AV_RTSP_BASE ?? "rtsp://127.0.0.1:8554";
export const INPUT_PATH = process.env.AV_INPUT_PATH ?? "assembly";
export const OUTPUT_PATH = process.env.AV_OUTPUT_PATH ?? "assembly-webrtc";

export const MEDIAMTX_API = process.env.AV_MEDIAMTX_API ?? "http://127.0.0.1:9997";
export const MEDIAMTX_HLS = process.env.AV_MEDIAMTX_HLS ?? "http://127.0.0.1:8888";
/** WebRTC port the browser connects to (on the same host that serves this app). */
export const WEBRTC_PORT = Number(process.env.AV_WEBRTC_PORT ?? 8889);

/** Declaration order is start order ("Start all"); "Stop all" goes in reverse. */
export const PROCS: Record<ProcName, ProcSpec> = {
  mediamtx: {
    name: "mediamtx",
    label: "MediaMTX",
    shortLabel: "MediaMTX",
    description: "RTSP / RTMP / WebRTC media server",
    bin: MEDIAMTX_BIN,
    args: [process.env.AV_MEDIAMTX_CONFIG ?? defaultMediamtxConfig()],
    // Enable the control API (local only) so the panel can see which paths are live,
    // without editing the root-owned config file.
    env: { MTX_API: "yes", MTX_APIADDRESS: "127.0.0.1:9997" },
    stopSignal: "SIGTERM",
    autoRestart: false,
    externalPattern: programPattern(MEDIAMTX_BIN, "( |$)"),
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
    externalPattern: programPattern(FFMPEG_BIN, ` .*/${OUTPUT_PATH}$`),
  },
};

export const PROC_NAMES = Object.keys(PROCS) as ProcName[];

/**
 * Spawn children through `setpriv --pdeathsig` so the kernel stops them if this server
 * dies without cleaning up (SIGKILL, crash). Set AV_PDEATHSIG=0 to disable. Linux only.
 */
export const PDEATHSIG = !IS_WINDOWS && process.env.AV_PDEATHSIG !== "0";

export function isProcName(s: string): s is ProcName {
  return Object.hasOwn(PROCS, s);
}

// OBS runs on this host and is controlled over obs-websocket (Tools → WebSocket Server Settings).
export const OBS_WS_URL = process.env.AV_OBS_WS_URL ?? "ws://127.0.0.1:4455";
/** Falls back to the password stored in OBS's own websocket config when unset. */
export const OBS_WS_PASSWORD = process.env.AV_OBS_WS_PASSWORD;
export const OBS_CONFIG_DIR =
  process.env.AV_OBS_CONFIG_DIR ??
  (IS_WINDOWS
    ? path.join(process.env.APPDATA ?? "", "obs-studio")
    : `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`}/obs-studio`);
