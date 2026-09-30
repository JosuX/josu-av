// API payload types, re-exported from the server modules that produce them.
// Type-only exports are erased at build time, so no server code reaches the client.

export type { ProcName } from "@/lib/config";
export type { LogLine, ProcState, ProcStatus } from "@/lib/procman";
export type { PathInfo } from "@/lib/mediamtx";
export type { StatSample } from "@/lib/sysstats";
export type { ObsPayload } from "@/lib/obs";
export type {
  AbrStatus,
  AutomationEvent,
  AutomationPayload,
  AutomationSettings,
  BitrateMode,
  HealthWarning,
  StatusPayload,
  ViewerInfo,
} from "@/lib/shared";
