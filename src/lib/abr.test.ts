import { describe, expect, it } from "vitest";
import { DOWN_COOLDOWN_MS, UP_AFTER_MS, decide, type AbrInput } from "./abr";
import { classifyViewer, viewerMetrics, type ViewerMetrics } from "./viewers";
import { isLiveCapable, parseScriptStatus } from "./live-bitrate";
import { fpsLabel, parseAutomationPatch, parseOutputPatch } from "./shared";

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
    expect(decide({ ...quiet, health: ["device", "good", "good"] }).action).toBe("hold");
  });

  it("lowers the bitrate for lagging devices too", () => {
    expect(decide({ ...base, health: ["device"] })).toMatchObject({
      action: "down",
      target: 4800,
      reason: "1 of 1 viewer is lagging",
    });
    expect(decide({ ...base, health: ["device", "device", "good"] })).toMatchObject({
      action: "down",
      reason: "2 of 3 viewers are lagging",
    });
  });

  it("counts a stream stalled upstream as struggling", () => {
    expect(decide({ ...base, health: ["source", "source", "good"] })).toMatchObject({
      action: "down",
      reason: "2 of 3 viewers are stalled upstream",
    });
    expect(decide({ ...base, health: ["network", "source", "device", "good"] })).toMatchObject({
      action: "down",
      reason: "3 of 4 viewers are struggling (1 losing packets, 1 lagging, 1 stalled upstream)",
    });
  });

  it("counts packet loss and lag together", () => {
    expect(decide({ ...base, health: ["network", "device", "good", "good"] })).toMatchObject({
      action: "down",
      reason: "2 of 4 viewers are struggling (1 losing packets, 1 lagging)",
    });
  });
});

const report = {
  id: "v1",
  label: "iPad · Safari",
  source: "watch page" as const,
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
    source: "dashboard",
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

describe("parseOutputPatch", () => {
  it("accepts bitrate, x264 preset and frame rate", () => {
    expect(parseOutputPatch({ bitrate: 4500, preset: "veryfast", fps: { num: 30000, den: 1001 } })).toEqual({
      patch: { bitrate: 4500, preset: "veryfast", fps: { num: 30000, den: 1001 } },
    });
  });
  it("rejects bad values and empty changes", () => {
    for (const body of [{ bitrate: 1 }, { preset: "turbo" }, { fps: { num: 500, den: 1 } }, { fps: { num: 30 } }, {}])
      expect(parseOutputPatch(body), JSON.stringify(body)).toHaveProperty("error");
  });
});

describe("fpsLabel", () => {
  it("names common rates and falls back to the number", () => {
    expect(fpsLabel({ num: 30000, den: 1001 })).toBe("29.97");
    expect(fpsLabel({ num: 60, den: 1 })).toBe("60");
    expect(fpsLabel({ num: 15, den: 1 })).toBe("15");
  });
});
