import type { ViewerHealth } from "./shared";

// Adaptive bitrate decisions. Every viewer gets the same stream (MediaMTX forwards it without
// re-encoding), so this picks one bitrate that works for most of them: drop quickly when
// enough viewers lose packets, climb back slowly after a long quiet spell.

/** Share of measured viewers that must be network-limited to lower the bitrate. */
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
  /** Last time any measured viewer was network-limited (or the stream started). */
  lastStruggleAt: number;
}

export type AbrDecision =
  | { action: "hold"; reason: string }
  | { action: "down" | "up"; target: number; reason: string };

const round100 = (n: number) => Math.round(n / 100) * 100;

export function decide(i: AbrInput): AbrDecision {
  const measured = i.health.filter((h) => h !== "unknown");
  if (!measured.length) return { action: "hold", reason: "No measured viewers" };
  const net = measured.filter((h) => h === "network").length;

  if (net / measured.length >= DOWN_SHARE) {
    const who = `${net} of ${measured.length} ${measured.length === 1 ? "viewer is" : "viewers are"} losing packets`;
    if (i.current <= i.min) return { action: "hold", reason: `${who}, but the bitrate is at its minimum` };
    if (i.now - i.lastChangeAt < DOWN_COOLDOWN_MS) return { action: "hold", reason: `${who}; waiting for the last change to settle` };
    return { action: "down", target: Math.max(i.min, round100(i.current * DOWN_FACTOR)), reason: who };
  }

  if (
    net === 0 &&
    i.current < i.ceiling &&
    i.now - i.lastStruggleAt >= UP_AFTER_MS &&
    i.now - i.lastChangeAt >= UP_AFTER_MS
  ) {
    const target = Math.min(i.ceiling, Math.max(i.current + 100, round100(i.current * (1 + UP_FACTOR))));
    return { action: "up", target, reason: `Viewers have played smoothly for ${UP_AFTER_MS / 60_000} minutes` };
  }
  return { action: "hold", reason: net ? `${net} of ${measured.length} viewers losing packets` : "Viewers are playing smoothly" };
}
