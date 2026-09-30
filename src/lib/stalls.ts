import type { ViewerInfo } from "./shared";

// A viewer that freezes or drops frames without losing packets looks like a slow device, but
// the stream may have stalled before it ever reached them: packets lost between OBS and
// MediaMTX, or OBS failing to encode in time. This tells the two apart, so the logs and advice
// point at the real cause.

/** Freezing together means the source: at least this many viewers, and this share of them. */
const TOGETHER_MIN = 2;
const TOGETHER_SHARE = 0.5;

export interface IngestEvidence {
  /** Packets MediaMTX lost from OBS during the viewers' window. */
  packetsLost: number;
  /** OBS is dropping frames while encoding or rendering. */
  encoderLag: boolean;
}

export interface Stall {
  /** Viewers affected. */
  count: number;
  /** Why the source is to blame, most direct evidence first. */
  reasons: string[];
}

/** Relabel lagging viewers as "source" when the evidence says the stream itself stalled. */
export function attributeStalls(viewers: ViewerInfo[], ingest: IngestEvidence): { viewers: ViewerInfo[]; stall: Stall | null } {
  const judged = viewers.filter((v) => !v.hidden && v.health !== "unknown");
  const lagging = judged.filter((v) => v.health === "device");
  if (!lagging.length) return { viewers, stall: null };

  const reasons: string[] = [];
  if (ingest.packetsLost > 0) reasons.push(`MediaMTX lost ${ingest.packetsLost} packets coming from OBS`);
  if (ingest.encoderLag) reasons.push("OBS is dropping frames while encoding");
  if (lagging.length >= TOGETHER_MIN && lagging.length / judged.length >= TOGETHER_SHARE)
    reasons.push(`${lagging.length} of ${judged.length} viewers froze at the same time`);
  if (!reasons.length) return { viewers, stall: null };

  const ids = new Set(lagging.map((v) => v.id));
  return {
    viewers: viewers.map((v) => (ids.has(v.id) ? { ...v, health: "source" as const } : v)),
    stall: { count: lagging.length, reasons },
  };
}
