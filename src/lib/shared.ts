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

/** Payload of GET /api/status. */
export interface StatusPayload {
  processes: ProcStatus[];
  paths: PathInfo[] | null;
  stream: {
    input: string;
    output: string;
    inputReady: boolean | null;
    outputReady: boolean;
    webrtcPort: number;
  };
}
