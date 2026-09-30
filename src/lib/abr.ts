import type { ViewerHealth } from "./shared";

// Adaptive bitrate decisions. Every viewer gets the same stream (MediaMTX forwards it without
// re-encoding), so this picks one bitrate that works for most of them: drop quickly when
// enough viewers struggle (losing packets or lagging), climb back slowly after a long quiet spell.

/** Share of measured viewers that must be struggling to lower the bitrate. */
export const DOWN_SHARE = 0.5;
/** Each step down keeps this fraction of the bitrate; each step up adds this fraction. */
const DOWN_FACTOR = 0.8;
const UP_FACTOR = 0.1;
/** Wait after any change before lowering again, so viewers' windows cover the new bitrate. */
export const DOWN_COOLDOWN_MS = 30_000;
/** Raise only after this long with no network-limited viewer and no change. */
export const UP_AFTER_MS = 10 * 60_000;

export interface AbrInput {
  now: number;
  current: number;
  /** The operator's configured bitrate; never exceeded. */
  ceiling: number;
  min: number;
  health: ViewerHealth[];
  lastChangeAt: number;
  /** Last time any measured viewer was struggling (or the stream started). */
  lastStruggleAt: number;
}

export type AbrDecision =
  | { action: "hold"; reason: string }
  | { action: "down" | "up"; target: number; reason: string };

const round100 = (n: number) => Math.round(n / 100) * 100;

export function decide(i: AbrInput): AbrDecision {
  const measured = i.health.filter((h) => h !== "unknown");
  if (!measured.length) return { action: "hold", reason: "No measured viewers" };
  // Both kinds of trouble call for less data: a network that can't carry it, or a device that
  // can't decode it smoothly (a lower bitrate eases decoding, if less than a lower resolution).
  const net = measured.filter((h) => h === "network").length;
  const dev = measured.filter((h) => h === "device").length;
  const struggling = net + dev;
  const who = `${struggling} of ${measured.length} ${measured.length === 1 ? "viewer is" : "viewers are"} ${
    dev === 0 ? "losing packets" : net === 0 ? "lagging" : `struggling (${net} losing packets, ${dev} lagging)`
  }`;

  if (struggling / measured.length >= DOWN_SHARE) {
    if (i.current <= i.min) return { action: "hold", reason: `${who}, but the bitrate is at its minimum` };
    if (i.now - i.lastChangeAt < DOWN_COOLDOWN_MS) return { action: "hold", reason: `${who}; waiting for the last change to settle` };
    return { action: "down", target: Math.max(i.min, round100(i.current * DOWN_FACTOR)), reason: who };
  }

  if (
    struggling === 0 &&
    i.current < i.ceiling &&
    i.now - i.lastStruggleAt >= UP_AFTER_MS &&
    i.now - i.lastChangeAt >= UP_AFTER_MS
  ) {
    const target = Math.min(i.ceiling, Math.max(i.current + 100, round100(i.current * (1 + UP_FACTOR))));
    return { action: "up", target, reason: `Viewers have played smoothly for ${UP_AFTER_MS / 60_000} minutes` };
  }
  return { action: "hold", reason: struggling ? who : "Viewers are playing smoothly" };
}
