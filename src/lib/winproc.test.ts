import { describe, expect, it } from "vitest";
import { parsePidCommandLines, parseTasklist } from "./winproc";

describe("parseTasklist", () => {
  it("reads the PIDs of the image, ignoring case", () => {
    const csv = `"mediamtx.exe","4120","Console","1","24,512 K"\r\n"MediaMTX.exe","5208","Console","1","20,100 K"\r\n`;
    expect(parseTasklist(csv, "mediamtx.exe")).toEqual([4120, 5208]);
  });

  it("finds nothing in the no-match message", () => {
    expect(parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n", "obs64.exe")).toEqual([]);
  });
});

describe("parsePidCommandLines", () => {
  const out = [
    `812 "C:\\ffmpeg\\bin\\ffmpeg.exe" -i rtsp://127.0.0.1:8554/assembly -f rtsp rtsp://127.0.0.1:8554/assembly-webrtc`,
    `944 ffmpeg -i input.mp4 output.mp4`,
    `1020 `,
  ].join("\r\n");

  it("keeps processes whose command line matches", () => {
    expect(parsePidCommandLines(out, /\/assembly-webrtc"?\s*$/)).toEqual([812]);
  });
});
