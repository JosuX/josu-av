import "server-only";
import { eventLogs } from "./eventlog";
import type { ViewerHealth, ViewerInfo, ViewerReport, ViewerSource } from "./shared";
import { formatDuration } from "@/components/format";

// Playback stats reported by the panel's players (VideoFeed), one entry per WebRTC connection.

/** Players report every 5 s; one silent for this long has gone. */
const STALE_MS = 15_000;
/** Metrics compare the newest report with the oldest one inside this window. */
const WINDOW_MS = 25_000;
/** Less history than this is too little to judge. */
const MIN_WINDOW_MS = 15_000;

/** A viewer losing this share of packets, or frozen while losing some, is network-limited. */
const LOSS_RATIO = 0.02;
const FREEZE_SEC = 1;
const FREEZE_LOSS_RATIO = 0.005;
/** Dropping this share of frames with little loss means the device can't decode fast enough. */
const DROP_RATIO = 0.05;

interface Sample extends ViewerReport {
  ts: number;
}

export interface ViewerMetrics {
  id: string;
  label: string;
  source: ViewerSource;
  hidden: boolean;
  windowMs: number;
  lossRatio: number;
  dropRatio: number;
  freezeSec: number;
  kbps: number;
  fps: number | null;
  resolution: string | null;
}

/** Window metrics from a viewer's reports, oldest first. */
export function viewerMetrics(samples: Sample[]): ViewerMetrics {
  const to = samples.at(-1)!;
  const from = samples[0];
  const d = (k: "packetsLost" | "packetsReceived" | "framesDecoded" | "framesDropped" | "freezeSec" | "bytesReceived") =>
    Math.max(0, to[k] - from[k]);
  const lost = d("packetsLost");
  const received = d("packetsReceived");
  const dropped = d("framesDropped");
  const decoded = d("framesDecoded");
  const windowMs = to.ts - from.ts;
  return {
    id: to.id,
    label: to.label,
    source: to.source,
    hidden: samples.some((s) => s.hidden),
    windowMs,
    lossRatio: lost + received ? lost / (lost + received) : 0,
    dropRatio: dropped + decoded ? dropped / (dropped + decoded) : 0,
    freezeSec: d("freezeSec"),
    kbps: windowMs ? (d("bytesReceived") * 8) / windowMs : 0,
    fps: to.fps,
    resolution: to.width && to.height ? `${to.width}×${to.height}` : null,
  };
}

export function classifyViewer(m: ViewerMetrics): ViewerHealth {
  if (m.hidden || m.windowMs < MIN_WINDOW_MS) return "unknown";
  if (m.lossRatio >= LOSS_RATIO || (m.freezeSec >= FREEZE_SEC && m.lossRatio >= FREEZE_LOSS_RATIO)) return "network";
  if (m.dropRatio >= DROP_RATIO || m.freezeSec >= FREEZE_SEC) return "device";
  return "good";
}

export function viewerInfo(m: ViewerMetrics): ViewerInfo {
  return {
    id: m.id,
    label: m.label,
    source: m.source,
    health: classifyViewer(m),
    lossPct: m.lossRatio * 100,
    dropPct: m.dropRatio * 100,
    freezeSec: m.freezeSec,
    kbps: Math.round(m.kbps),
    fps: m.fps,
    resolution: m.resolution,
    hidden: m.hidden,
  };
}

class ViewerRegistry {
  private viewers = new Map<string, { samples: Sample[]; since: number }>();

  /** Add a report; `from` is the player's address, for the clients log. */
  report(r: ViewerReport, now = Date.now(), from: string | null = null) {
    let v = this.viewers.get(r.id);
    if (!v) {
      v = { samples: [], since: now };
      this.viewers.set(r.id, v);
      eventLogs.clients.info(`Viewer joined: ${r.label}${from ? ` from ${from}` : ""}`);
    }
    const list = v.samples;
    list.push({ ...r, ts: now });
    while (list.length > 1 && now - list[1].ts >= WINDOW_MS) list.shift();
  }

  /** Current viewers' metrics, dropping those that stopped reporting. */
  metrics(now = Date.now()): ViewerMetrics[] {
    const out: ViewerMetrics[] = [];
    for (const [id, v] of this.viewers) {
      const last = v.samples.at(-1)!;
      if (now - last.ts > STALE_MS) {
        this.viewers.delete(id);
        eventLogs.clients.info(`Viewer left: ${last.label} after ${formatDuration(last.ts - v.since)}`);
      } else out.push(viewerMetrics(v.samples));
    }
    return out;
  }
}

const g = globalThis as unknown as { __avViewers?: ViewerRegistry };
export const viewers = (g.__avViewers ??= new ViewerRegistry());
