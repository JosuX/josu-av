import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ObsBusyError,
  ObsError,
  parseEffectiveBitrate,
  parseEncoderStarts,
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
      }
      return {} as T;
    },
  };
  return { obs, calls, isActive: () => active };
}

const live = { active: true, reconnecting: false, durationMs: 0, bytes: 0 };
const off = { ...live, active: false };

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
