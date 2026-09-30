import { describe, expect, it } from "vitest";
import { cameraAction, codecWarnings, frameWarnings, keepLiveRetryMs, type FrameSample } from "./supervisor";
import { DEFAULT_AUTOMATION, parseAutomationSettings } from "./automation-settings";

describe("cameraAction", () => {
  const T = 100_000;
  it("leaves a playing camera alone", () => {
    expect(cameraAction("OBS_MEDIA_STATE_PLAYING", 0, 0, T)).toBe("ok");
  });

  it("reloads a failed camera after 5 s", () => {
    expect(cameraAction("OBS_MEDIA_STATE_ERROR", T - 4000, 0, T)).toBe("wait");
    expect(cameraAction("OBS_MEDIA_STATE_ERROR", T - 5000, 0, T)).toBe("reload");
    expect(cameraAction("OBS_MEDIA_STATE_ENDED", T - 5000, 0, T)).toBe("reload");
  });

  it("gives a loading camera 20 s", () => {
    expect(cameraAction("OBS_MEDIA_STATE_OPENING", T - 10_000, 0, T)).toBe("wait");
    expect(cameraAction("OBS_MEDIA_STATE_BUFFERING", T - 20_000, 0, T)).toBe("reload");
  });

  it("reloads the same camera at most every 30 s", () => {
    expect(cameraAction("OBS_MEDIA_STATE_ERROR", T - 10_000, T - 29_000, T)).toBe("wait");
    expect(cameraAction("OBS_MEDIA_STATE_ERROR", T - 10_000, T - 30_000, T)).toBe("reload");
  });
});

describe("keepLiveRetryMs", () => {
  it("doubles from 5 s up to a minute", () => {
    expect([1, 2, 3, 4, 5].map(keepLiveRetryMs)).toEqual([5000, 10_000, 20_000, 40_000, 60_000]);
  });
});

describe("frameWarnings", () => {
  const base: FrameSample = {
    ts: 0,
    netSkipped: 0,
    netTotal: 0,
    renderSkipped: 0,
    renderTotal: 0,
    encodeSkipped: 0,
    encodeTotal: 0,
    congestion: 0,
  };
  const later = (over: Partial<FrameSample>): FrameSample => ({
    ...base,
    ts: 15_000,
    netTotal: 450,
    renderTotal: 450,
    encodeTotal: 450,
    ...over,
  });

  it("is quiet for a healthy stream", () => {
    expect(frameWarnings(base, later({ netSkipped: 2 }))).toEqual([]);
  });

  it("flags network, encoding and rendering drops of 2% or more", () => {
    const ws = frameWarnings(base, later({ netSkipped: 45, encodeSkipped: 9, renderSkipped: 20 }));
    expect(ws.map((w) => w.id)).toEqual(["quality-network", "quality-encoding", "quality-rendering"]);
    expect(ws[0].detail).toMatch(/10\.0% of frames dropped in the last 15s/);
  });

  it("flags congestion", () => {
    expect(frameWarnings(base, later({ congestion: 0.8 })).map((w) => w.id)).toEqual(["quality-congestion"]);
  });
});

describe("codecWarnings", () => {
  it("accepts H.264", () => {
    expect(codecWarnings("obs_x264", ["H264", "Opus"])).toEqual([]);
  });

  it("flags an H.265 or AV1 encoder before anything is published", () => {
    expect(codecWarnings("jim_hevc_nvenc", [])[0].title).toMatch(/H\.265/);
    expect(codecWarnings("obs_qsv11_av1", [])[0].title).toMatch(/AV1/);
  });

  it("flags a published H.265 track without OBS", () => {
    expect(codecWarnings(null, ["H265", "Opus"])[0].title).toMatch(/H\.265/);
  });
});

describe("parseAutomationSettings", () => {
  it("keeps valid booleans and defaults the rest", () => {
    expect(parseAutomationSettings({ keepStreamLive: true, keepWhip: "yes", other: 1 })).toEqual({
      ...DEFAULT_AUTOMATION,
      keepStreamLive: true,
    });
    expect(parseAutomationSettings(null)).toEqual(DEFAULT_AUTOMATION);
  });
});
