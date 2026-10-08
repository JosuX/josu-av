import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ObsBusyError,
  ObsError,
  encoderCodec,
  ingest,
  parseEffectiveBitrate,
  parseEncoderStarts,
  applyOutput,
  restartStream,
  stoppedByPanel,
  switchToWhip,
  type ObsSession,
} from "./obs";

// Excerpts from real OBS 32 logs.
const X264 = `13:54:17.910: [x264 encoder: 'advanced_video_stream'] preset: medium
13:54:17.912: [x264 encoder: 'advanced_video_stream'] settings:
13:54:17.912: \trate_control: CBR
13:54:17.912: \tbitrate:      6000
13:54:17.912: \tbuffer size:  6000
`;

const VAAPI = `13:56:14.453: [FFmpeg VAAPI encoder: 'advanced_video_stream'] settings:
13:56:14.453: \tdevice:       /dev/dri/by-path/pci-0000:00:02.0-render
13:56:14.453: \trate_control: CBR
13:56:14.453: \tprofile:      1
13:56:14.453: \tlevel:        -99
13:56:14.453: \tqp:           0
13:56:14.453: \tbitrate:      1000
13:56:14.453: \tmaxrate:      1000
`;

describe("parseEncoderStarts", () => {
  it("lists every stream start, oldest first", () => {
    expect(parseEncoderStarts(X264 + VAAPI + X264)).toEqual([6000, 1000, 6000]);
  });

  it("reads CRLF logs (Windows)", () => {
    expect(parseEncoderStarts((X264 + VAAPI).replace(/\n/g, "\r\n"))).toEqual([6000, 1000]);
  });
});

describe("parseEffectiveBitrate", () => {
  it("reads the bitrate from an encoder settings block", () => {
    expect(parseEffectiveBitrate(X264)).toBe(6000);
  });

  it("finds bitrate lines several settings down", () => {
    expect(parseEffectiveBitrate(VAAPI)).toBe(1000);
  });

  it("uses the most recent stream start", () => {
    expect(parseEffectiveBitrate(X264 + "13:55:00.000: ==== Streaming Stop ====\n" + VAAPI)).toBe(1000);
  });

  it("ignores recording encoders", () => {
    expect(parseEffectiveBitrate(X264.replaceAll("advanced_video_stream", "advanced_video_recording"))).toBeNull();
  });

  it("returns null when nothing was streamed", () => {
    expect(parseEffectiveBitrate("13:00:00.000: OBS started\n")).toBeNull();
  });
});

// A fake OBS whose stream goes live/off as soon as it is told to. `startFailures` makes
// that many StartStream calls fail first.
function fakeObs({ active = true, startFailures = 0, serviceFails = false } = {}) {
  const calls: string[] = [];
  const obs: ObsSession = {
    async call<T>(type: string) {
      calls.push(type);
      switch (type) {
        case "GetStreamStatus":
          return { outputActive: active, outputReconnecting: false, outputDuration: 0, outputBytes: 0 } as T;
        case "StopStream":
          active = false;
          break;
        case "StartStream":
          if (startFailures-- > 0) throw new ObsError("StartStream failed: output failed to start");
          active = true;
          break;
        case "SetStreamServiceSettings":
          if (serviceFails) throw new ObsError("SetStreamServiceSettings failed");
          break;
        case "SetVideoSettings":
          // Like OBS: refused while an output is active.
          if (active) throw new ObsError("SetVideoSettings failed: Video settings cannot be changed while an output is active.");
          break;
      }
      return {} as T;
    },
  };
  return { obs, calls, isActive: () => active };
}

const live = { active: true, reconnecting: false, durationMs: 0, bytes: 0, congestion: 0, skippedFrames: 0, totalFrames: 0 };
const off = { ...live, active: false };

// Never ask a real MediaMTX: by default the stream counts as received as soon as OBS starts.
const realIngestReady = ingest.ready;
beforeEach(() => {
  ingest.ready = async () => true;
});
afterEach(() => {
  ingest.ready = realIngestReady;
});

describe("restartStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    stoppedByPanel(live); // reset shared state
  });

  it("stops and starts a live stream", async () => {
    const { obs, calls, isActive } = fakeObs();
    await restartStream(obs);
    expect(isActive()).toBe(true);
    expect(calls.filter((c) => c !== "GetStreamStatus")).toEqual(["StopStream", "StartStream"]);
  });

  it("retries a failed start once", async () => {
    const { obs, isActive } = fakeObs({ startFailures: 1 });
    const done = restartStream(obs);
    await vi.runAllTimersAsync();
    await done;
    expect(isActive()).toBe(true);
    expect(stoppedByPanel(off)).toBeNull();
  });

  it("reports the stream as off when it cannot start again", async () => {
    const { obs, isActive } = fakeObs({ startFailures: 2 });
    const done = expect(restartStream(obs)).rejects.toThrow(/stream is OFF/);
    await vi.runAllTimersAsync();
    await done;
    expect(isActive()).toBe(false);
    expect(stoppedByPanel(off)).toMatch(/output failed to start/);
    // Starting the stream from OBS itself clears it.
    expect(stoppedByPanel(live)).toBeNull();
  });

  it("refuses a second restart while one is running", async () => {
    const { obs } = fakeObs({ startFailures: 1 });
    const first = restartStream(obs);
    await expect(restartStream(obs)).rejects.toBeInstanceOf(ObsBusyError);
    await vi.runAllTimersAsync();
    await first;
  });
});

describe("switchToWhip", () => {
  afterEach(() => stoppedByPanel(live));

  it("restarts the stream even when the service change fails", async () => {
    const { obs, isActive } = fakeObs({ serviceFails: true });
    await expect(switchToWhip(obs)).rejects.toThrow(/SetStreamServiceSettings failed/);
    expect(isActive()).toBe(true);
  });

  it("leaves an idle stream idle", async () => {
    const { obs, calls, isActive } = fakeObs({ active: false });
    await switchToWhip(obs);
    expect(isActive()).toBe(false);
    expect(calls).not.toContain("StartStream");
  });
});

describe("encoderCodec", () => {
  it.each([
    ["obs_x264", "H.264"],
    ["ffmpeg_vaapi_tex", "H.264"],
    ["x264", "H.264"],
    ["nvenc", "H.264"],
    ["jim_hevc_nvenc", "H.265"],
    ["ffmpeg_hevc_vaapi_tex", "H.265"],
    ["nvenc_hevc", "H.265"],
    ["obs_qsv11_av1", "AV1"],
    ["jim_av1_nvenc", "AV1"],
  ])("%s → %s", (id, codec) => {
    expect(encoderCodec(id)).toBe(codec);
  });
});

describe("applyOutput", () => {
  afterEach(() => stoppedByPanel(live));

  it("changes the frame rate of a live stream by stopping it once", async () => {
    const { obs, calls, isActive } = fakeObs();
    expect(await applyOutput(obs, { fps: { num: 30, den: 1 } })).toBe(true);
    expect(isActive()).toBe(true);
    expect(calls.filter((c) => c !== "GetStreamStatus")).toEqual(["StopStream", "SetVideoSettings", "StartStream"]);
  });

  it("changes an idle stream's frame rate without starting it", async () => {
    const { obs, calls, isActive } = fakeObs({ active: false });
    expect(await applyOutput(obs, { fps: { num: 30, den: 1 } })).toBe(false);
    expect(isActive()).toBe(false);
    expect(calls).not.toContain("StartStream");
  });
});

describe("restartStream waits for MediaMTX to receive the stream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    stoppedByPanel(live);
  });

  it("stops a start that never reaches MediaMTX and retries it", async () => {
    const { obs, calls, isActive } = fakeObs();
    // Nothing arrives for the first attempt; the retry's stream does.
    let starts = 0;
    const call = obs.call.bind(obs);
    obs.call = (async (type: string, data?: Record<string, unknown>) => {
      if (type === "StartStream") starts++;
      return call(type, data);
    }) as ObsSession["call"];
    ingest.ready = async () => starts >= 2;

    const done = restartStream(obs);
    await vi.runAllTimersAsync();
    await done;
    expect(isActive()).toBe(true);
    expect(calls.filter((c) => c !== "GetStreamStatus")).toEqual(["StopStream", "StartStream", "StopStream", "StartStream"]);
    expect(stoppedByPanel(off)).toBeNull();
  });

  it("reports the stream as off when MediaMTX never receives it", async () => {
    const { obs, isActive } = fakeObs();
    ingest.ready = async () => false;
    const done = expect(restartStream(obs)).rejects.toThrow(/stream is OFF.*MediaMTX received nothing/);
    await vi.runAllTimersAsync();
    await done;
    // The stuck output isn't left running as if all were well.
    expect(isActive()).toBe(false);
  });

  it("doesn't wait when MediaMTX can't be asked", async () => {
    const { obs, isActive } = fakeObs();
    ingest.ready = async () => null;
    await restartStream(obs);
    expect(isActive()).toBe(true);
  });
});
