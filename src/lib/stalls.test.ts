import { describe, expect, it } from "vitest";
import { attributeStalls } from "./stalls";
import type { ViewerInfo } from "./shared";

const viewer = (id: string, health: ViewerInfo["health"], over: Partial<ViewerInfo> = {}): ViewerInfo => ({
  id,
  label: id,
  source: "watch page",
  health,
  lossPct: 0,
  dropPct: 0,
  freezeSec: health === "device" ? 3 : 0,
  kbps: 6000,
  fps: 30,
  resolution: "1920×1080",
  hidden: false,
  ...over,
});
const clean = { packetsLost: 0, encoderLag: false };
const healths = (vs: ViewerInfo[]) => vs.map((v) => v.health);

describe("attributeStalls", () => {
  it("leaves a lone lagging viewer on a clean source alone: that's their device", () => {
    const r = attributeStalls([viewer("a", "device"), viewer("b", "good"), viewer("c", "good")], clean);
    expect(healths(r.viewers)).toEqual(["device", "good", "good"]);
    expect(r.stall).toBeNull();
  });

  it("blames the source when viewers freeze together", () => {
    const r = attributeStalls([viewer("a", "device"), viewer("b", "device"), viewer("c", "good")], clean);
    expect(healths(r.viewers)).toEqual(["source", "source", "good"]);
    expect(r.stall).toEqual({ count: 2, reasons: ["2 of 3 viewers froze at the same time"] });
  });

  it("blames the source for any lag while MediaMTX loses packets from OBS", () => {
    const r = attributeStalls([viewer("a", "device"), viewer("b", "good")], { packetsLost: 42, encoderLag: false });
    expect(healths(r.viewers)).toEqual(["source", "good"]);
    expect(r.stall?.reasons).toEqual(["MediaMTX lost 42 packets coming from OBS"]);
  });

  it("blames the source while OBS drops frames encoding", () => {
    const r = attributeStalls([viewer("a", "device")], { packetsLost: 0, encoderLag: true });
    expect(healths(r.viewers)).toEqual(["source"]);
    expect(r.stall?.reasons).toEqual(["OBS is dropping frames while encoding"]);
  });

  it("never relabels packet loss, and ignores background and unmeasured viewers", () => {
    const r = attributeStalls(
      [viewer("a", "network"), viewer("b", "device", { hidden: true }), viewer("c", "unknown")],
      { packetsLost: 10, encoderLag: true },
    );
    expect(healths(r.viewers)).toEqual(["network", "device", "unknown"]);
    expect(r.stall).toBeNull();
  });
});
