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

/** Automations the operator can switch on and off (Settings page). */
export interface AutomationSettings {
  /** Start OBS's stream whenever it is off. */
  keepStreamLive: boolean;
  /** Reopen camera sources that stop playing. */
  reconnectCameras: boolean;
  /** Point OBS back at the WHIP endpoint while the stream is idle (WHIP ingest only). */
  keepWhip: boolean;
}

export const AUTOMATION_KEYS = ["keepStreamLive", "reconnectCameras", "keepWhip"] as const satisfies readonly (keyof AutomationSettings)[];

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
  ingest: "whip" | "rtmp";
  obsConnected: boolean;
  warnings: HealthWarning[];
  events: AutomationEvent[];
}

/** Payload of GET /api/status. */
export interface StatusPayload {
  processes: ProcStatus[];
  paths: PathInfo[] | null;
  warnings: HealthWarning[];
  stream: {
    /** "whip": OBS publishes Opus straight to `input` (== `output`); "rtmp": FFmpeg bridges them. */
    ingest: "whip" | "rtmp";
    input: string;
    output: string;
    inputReady: boolean | null;
    outputReady: boolean;
    webrtcPort: number;
  };
}
