import { describe, expect, it } from "vitest";
import { DOWN_COOLDOWN_MS, UP_AFTER_MS, decide, type AbrInput } from "./abr";
import { classifyViewer, viewerMetrics, type ViewerMetrics } from "./viewers";
import { isLiveCapable, parseScriptStatus } from "./live-bitrate";
import { parseAutomationPatch } from "./shared";

const NOW = 100 * 60_000;
const base: AbrInput = {
  now: NOW,
  current: 6000,
  ceiling: 6000,
  min: 1500,
  health: ["good"],
  lastChangeAt: 0,
  lastStruggleAt: NOW,
};

describe("decide", () => {
  it("holds without measured viewers", () => {
    expect(decide({ ...base, health: ["unknown"] }).action).toBe("hold");
  });

  it("lowers by 20% when most viewers lose packets", () => {
    expect(decide({ ...base, health: ["network", "network", "good"] })).toMatchObject({
      action: "down",
      target: 4800,
      reason: "2 of 3 viewers are losing packets",
    });
  });

  it("ignores a single struggling viewer among several", () => {
    expect(decide({ ...base, health: ["network", "good", "good"] }).action).toBe("hold");
  });

  it("waits for the last change to settle", () => {
    const i = { ...base, health: ["network" as const] };
    expect(decide({ ...i, lastChangeAt: NOW - DOWN_COOLDOWN_MS + 1 }).action).toBe("hold");
    expect(decide({ ...i, lastChangeAt: NOW - DOWN_COOLDOWN_MS }).action).toBe("down");
  });

  it("never goes below the floor", () => {
    expect(decide({ ...base, current: 1700, health: ["network"] })).toMatchObject({ action: "down", target: 1500 });
    expect(decide({ ...base, current: 1500, health: ["network"] }).action).toBe("hold");
  });

  it("raises after 10 quiet minutes, up to the ceiling", () => {
    const quiet = { ...base, current: 4000, lastStruggleAt: NOW - UP_AFTER_MS, lastChangeAt: NOW - UP_AFTER_MS };
    expect(decide(quiet)).toMatchObject({ action: "up", target: 4400 });
    expect(decide({ ...quiet, current: 5900 })).toMatchObject({ action: "up", target: 6000 });
    expect(decide({ ...quiet, lastStruggleAt: NOW - UP_AFTER_MS + 1 }).action).toBe("hold");
    expect(decide({ ...quiet, current: 6000 }).action).toBe("hold");
  });

  it("does not raise while any viewer struggles", () => {
    const quiet = { ...base, current: 4000, lastStruggleAt: 0, lastChangeAt: 0 };
    expect(decide({ ...quiet, health: ["network", "good", "good"] }).action).toBe("hold");
  });
});

const report = {
  id: "v1",
  label: "iPad · Safari",
  hidden: false,
  packetsLost: 0,
  packetsReceived: 0,
  framesDecoded: 0,
  framesDropped: 0,
  freezeSec: 0,
  bytesReceived: 0,
  fps: 30,
  width: 1280,
  height: 720,
};

describe("viewerMetrics", () => {
  it("measures the change across the window", () => {
    const m = viewerMetrics([
      { ...report, ts: 0 },
      {
        ...report,
        ts: 20_000,
        packetsLost: 30,
        packetsReceived: 970,
        framesDecoded: 600,
        framesDropped: 0,
        bytesReceived: 10_000_000,
      },
    ]);
    expect(m).toMatchObject({ windowMs: 20_000, lossRatio: 0.03, dropRatio: 0, kbps: 4000, resolution: "1280×720" });
  });
});

describe("classifyViewer", () => {
  const m: ViewerMetrics = {
    id: "v",
    label: "",
    hidden: false,
    windowMs: 20_000,
    lossRatio: 0,
    dropRatio: 0,
    freezeSec: 0,
    kbps: 0,
    fps: 30,
    resolution: null,
  };
  it.each([
    [{}, "good"],
    [{ lossRatio: 0.02 }, "network"],
    [{ freezeSec: 2, lossRatio: 0.01 }, "network"],
    [{ freezeSec: 2 }, "device"],
    [{ dropRatio: 0.1 }, "device"],
    [{ windowMs: 10_000, lossRatio: 0.5 }, "unknown"],
    [{ hidden: true, lossRatio: 0.5 }, "unknown"],
  ] as const)("%o → %s", (over, health) => {
    expect(classifyViewer({ ...m, ...over })).toBe(health);
  });
});

describe("parseScriptStatus", () => {
  const txt = (ts: number) => `ts=${ts}\nactive=true\nencoder=obs_x264\nbitrate=4800\n`;
  it("reads a fresh status", () => {
    expect(parseScriptStatus(txt(1000), 1_005_000)).toEqual({ active: true, encoder: "obs_x264", bitrate: 4800 });
  });
  it("treats a stale status as no script", () => {
    expect(parseScriptStatus(txt(1000), 1_020_000)).toBeNull();
  });
});

describe("isLiveCapable", () => {
  it("accepts x264 and NVENC only", () => {
    expect(["obs_x264", "jim_nvenc", "obs_nvenc_h264_tex", "ffmpeg_vaapi_tex", null].map(isLiveCapable)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("parseAutomationPatch", () => {
  it("validates each kind of setting", () => {
    expect(parseAutomationPatch({ adaptiveBitrate: "auto", minBitrate: 2000, launchObs: true })).toEqual({
      patch: { adaptiveBitrate: "auto", minBitrate: 2000, launchObs: true },
    });
    expect(parseAutomationPatch({ adaptiveBitrate: "fast" })).toHaveProperty("error");
    expect(parseAutomationPatch({ minBitrate: 10 })).toHaveProperty("error");
    expect(parseAutomationPatch({ keepWhip: "yes" })).toHaveProperty("error");
    expect(parseAutomationPatch({ nope: true })).toHaveProperty("error");
  });
});
