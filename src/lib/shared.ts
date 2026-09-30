// Constants and types shared by the API routes and the client. Keep this free of
// server-only value imports and process.env reads so it can be bundled for the browser.

import type { ProcStatus } from "./procman";
import type { PathInfo } from "./mediamtx";

export const PROC_ACTIONS = ["start", "stop", "restart", "kill-external", "clear-logs"] as const;
export type ProcAction = (typeof PROC_ACTIONS)[number];

export function isProcAction(s: unknown): s is ProcAction {
  return PROC_ACTIONS.includes(s as ProcAction);
}

/** Log lines kept per process, on the server and in each open console. */
export const LOG_MAX_LINES = 3000;

/** Stats samples kept (1 per second). */
export const STATS_HISTORY = 300;

/** Accepted OBS video bitrate range, kbps. */
export const BITRATE_MIN = 300;
export const BITRATE_MAX = 50000;

export function isValidBitrate(n: number) {
  return Number.isInteger(n) && n >= BITRATE_MIN && n <= BITRATE_MAX;
}

/**
 * Adaptive bitrate. "recommend" suggests changes from viewers' playback stats; "auto" applies
 * them live through the OBS script (never by restarting the stream).
 */
export type BitrateMode = "off" | "recommend" | "auto";
export const BITRATE_MODES = ["off", "recommend", "auto"] as const satisfies readonly BitrateMode[];

/** Automations the operator can switch on and off (Settings page). */
export interface AutomationSettings {
  /** Start OBS's stream whenever it is off. */
  keepStreamLive: boolean;
  /** Reopen camera sources that stop playing. */
  reconnectCameras: boolean;
  /** Point OBS back at the WHIP endpoint while the stream is idle (WHIP ingest only). */
  keepWhip: boolean;
  /** Open OBS when MediaMTX is up and OBS isn't running. */
  launchObs: boolean;
  adaptiveBitrate: BitrateMode;
  /** Adaptive bitrate never goes below this, kbps. */
  minBitrate: number;
}

export const AUTOMATION_SWITCHES = ["keepStreamLive", "reconnectCameras", "keepWhip", "launchObs"] as const satisfies readonly (keyof AutomationSettings)[];

export const DEFAULT_AUTOMATION: AutomationSettings = {
  keepStreamLive: false,
  reconnectCameras: true,
  keepWhip: true,
  launchObs: false,
  adaptiveBitrate: "recommend",
  minBitrate: 1500,
};

/** Validate a partial settings update, e.g. from POST /api/automation. */
export function parseAutomationPatch(body: unknown): { patch: Partial<AutomationSettings> } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "expected a JSON object" };
  const patch: Partial<AutomationSettings> = {};
  for (const [k, v] of Object.entries(body)) {
    if ((AUTOMATION_SWITCHES as readonly string[]).includes(k)) {
      if (typeof v !== "boolean") return { error: `${k} must be true or false` };
      patch[k as (typeof AUTOMATION_SWITCHES)[number]] = v;
    } else if (k === "adaptiveBitrate") {
      if (!BITRATE_MODES.includes(v as BitrateMode)) return { error: `adaptiveBitrate must be ${BITRATE_MODES.join(", ")}` };
      patch.adaptiveBitrate = v as BitrateMode;
    } else if (k === "minBitrate") {
      if (typeof v !== "number" || !isValidBitrate(v)) return { error: `minBitrate must be ${BITRATE_MIN}–${BITRATE_MAX} kbps` };
      patch.minBitrate = v;
    } else {
      return { error: `unknown setting ${k}` };
    }
  }
  return { patch };
}

/** How a viewer's playback is going. "device": dropping frames without losing packets. */
export type ViewerHealth = "good" | "network" | "device" | "unknown";

export interface ViewerInfo {
  id: string;
  label: string;
  health: ViewerHealth;
  lossPct: number;
  dropPct: number;
  /** Seconds spent frozen within the window. */
  freezeSec: number;
  kbps: number;
  fps: number | null;
  resolution: string | null;
  /** The page is in the background, so its stats say nothing about the network. */
  hidden: boolean;
}

export interface AbrStatus {
  mode: BitrateMode;
  streamActive: boolean;
  /** Bitrate the encoder runs at now, kbps (from the OBS script when present, else the profile). */
  current: number | null;
  /** The profile's saved bitrate: adaptive bitrate never goes above it. */
  ceiling: number | null;
  min: number;
  /** Measured from OBS's output byte counter. */
  outputKbps: number | null;
  script: {
    state: "ok" | "missing";
    /** Absolute path of the Lua script to add in OBS (Tools → Scripts). */
    path: string;
    encoder: string | null;
    /** Whether that encoder is known to accept bitrate changes while streaming. */
    liveCapable: boolean;
  };
  viewers: ViewerInfo[];
  /** MediaMTX readers the panel can't measure (e.g. its own player page). */
  unmeasured: number;
  recommendation: { direction: "down" | "up"; target: number; reason: string } | null;
  lastChange: { ts: number; from: number; to: number; reason: string; auto: boolean } | null;
}

/** Stats a player sends to POST /api/viewers; counters are cumulative for the connection. */
export interface ViewerReport {
  id: string;
  label: string;
  hidden: boolean;
  packetsLost: number;
  packetsReceived: number;
  framesDecoded: number;
  framesDropped: number;
  freezeSec: number;
  bytesReceived: number;
  fps: number | null;
  width: number | null;
  height: number | null;
}

/** A problem the operator should know about, shown on the dashboard while it lasts. */
export interface HealthWarning {
  id: string;
  level: "warning" | "error";
  title: string;
  detail: string;
}

/** Something an automation did or noticed. */
export interface AutomationEvent {
  id: number;
  ts: number;
  level: "info" | "warning" | "error";
  text: string;
}

/** Payload of GET /api/automation. */
export interface AutomationPayload {
  settings: AutomationSettings;
  abr: AbrStatus | null;
  ingest: "whip" | "rtmp";
  obsConnected: boolean;
  warnings: HealthWarning[];
  events: AutomationEvent[];
}

/** x264's speed presets, fastest first. Faster ones use less CPU for slightly lower quality. */
export const X264_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;

export interface Fps {
  num: number;
  den: number;
}

/** Frame rates offered in Settings. */
export const FPS_OPTIONS: { label: string; fps: Fps }[] = [
  { label: "24", fps: { num: 24, den: 1 } },
  { label: "25", fps: { num: 25, den: 1 } },
  { label: "29.97", fps: { num: 30000, den: 1001 } },
  { label: "30", fps: { num: 30, den: 1 } },
  { label: "50", fps: { num: 50, den: 1 } },
  { label: "59.94", fps: { num: 60000, den: 1001 } },
  { label: "60", fps: { num: 60, den: 1 } },
];

export function fpsLabel(f: Fps) {
  return FPS_OPTIONS.find((o) => o.fps.num === f.num && o.fps.den === f.den)?.label ?? String(+(f.num / f.den).toFixed(2));
}

/** Stream output changes applied together (with one restart when live). */
export interface OutputPatch {
  bitrate?: number;
  preset?: (typeof X264_PRESETS)[number];
  fps?: Fps;
}

export function parseOutputPatch(body: Record<string, unknown>): { patch: OutputPatch } | { error: string } {
  const patch: OutputPatch = {};
  if (body.bitrate !== undefined) {
    if (typeof body.bitrate !== "number" || !isValidBitrate(body.bitrate))
      return { error: `Bitrate must be a whole number between ${BITRATE_MIN} and ${BITRATE_MAX} kbps` };
    patch.bitrate = body.bitrate;
  }
  if (body.preset !== undefined) {
    if (!X264_PRESETS.includes(body.preset as OutputPatch["preset"] & string)) return { error: "Unknown encoder preset" };
    patch.preset = body.preset as OutputPatch["preset"];
  }
  if (body.fps !== undefined) {
    const f = body.fps as Partial<Fps> | null;
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
    if (!f || !ok(f.num) || !ok(f.den) || f.num! / f.den! < 1 || f.num! / f.den! > 120)
      return { error: "Frame rate must be between 1 and 120 fps" };
    patch.fps = { num: f.num!, den: f.den! };
  }
  if (!Object.keys(patch).length) return { error: "Nothing to change" };
  return { patch };
}

/** Payload of GET /api/status. */
export interface StatusPayload {
  processes: ProcStatus[];
  paths: PathInfo[] | null;
  warnings: HealthWarning[];
  /** Null until the first automation check. */
  abr: AbrStatus | null;
  stream: {
    /** "whip": OBS publishes Opus straight to `input` (== `output`); "rtmp": FFmpeg bridges them. */
    ingest: "whip" | "rtmp";
    input: string;
    output: string;
    inputReady: boolean | null;
    outputReady: boolean;
    webrtcPort: number;
    /** Port of the viewer-only page, or null when it is off. */
    viewerPort: number | null;
  };
}

/** Payload of GET /api/watch, the only status the viewer page gets. */
export interface WatchPayload {
  live: boolean;
  path: string;
  webrtcPort: number;
}
