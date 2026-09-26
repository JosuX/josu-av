// Client-side mirrors of the API payloads.

export type ProcName = "mediamtx" | "ffmpeg";
export type ProcState = "stopped" | "starting" | "running" | "stopping" | "restarting" | "crashed";

export interface ProcStatus {
  name: ProcName;
  label: string;
  state: ProcState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  exitSignal: string | null;
  restarts: number;
  command: string;
  externalPids: number[];
}

export interface PathInfo {
  name: string;
  ready: boolean;
  source: string | null;
  tracks: string[];
  readers: number;
  bytesReceived: number;
}

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

export interface LogLine {
  id: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface StatSample {
  ts: number;
  iface: string;
  rxBps: number;
  txBps: number;
  memUsed: number;
  memTotal: number;
}
