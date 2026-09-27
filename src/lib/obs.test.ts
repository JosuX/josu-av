import { describe, expect, it } from "vitest";
import { parseEffectiveBitrate, parseEncoderStarts } from "./obs";

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
