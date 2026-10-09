import { describe, expect, it } from "vitest";
import { PROCS } from "./config";

const matches = (name: keyof typeof PROCS, cmd: string) =>
  new RegExp(PROCS[name].externalPattern, process.platform === "win32" ? "i" : "").test(cmd);

describe.runIf(process.platform === "win32")("externalPattern (Windows command lines)", () => {
  it("matches mediamtx however it was launched", () => {
    expect(matches("mediamtx", '"C:\\Program Files\\mediamtx\\mediamtx.exe" C:\\cfg\\mediamtx.yml')).toBe(true);
    expect(matches("mediamtx", "C:\\tools\\MediaMTX.EXE")).toBe(true);
    expect(matches("mediamtx", "mediamtx C:\\cfg\\mediamtx.yml")).toBe(true);
    expect(matches("mediamtx", '"C:\\x\\notmediamtx.exe"')).toBe(false);
  });

  it("matches only the ffmpeg that publishes the WebRTC path", () => {
    expect(matches("ffmpeg", "ffmpeg -i rtsp://127.0.0.1:8554/assembly -f rtsp rtsp://127.0.0.1:8554/assembly-webrtc")).toBe(true);
    expect(matches("ffmpeg", '"C:\\ff\\bin\\ffmpeg.exe" -i in.mp4 -f rtsp rtsp://h:8554/assembly-webrtc')).toBe(true);
    expect(matches("ffmpeg", '"C:\\ff\\bin\\ffmpeg.exe" -i in.mp4 out.mp4')).toBe(false);
  });
});

describe.runIf(process.platform !== "win32")("externalPattern (Linux command lines)", () => {
  it("matches mediamtx and the WebRTC ffmpeg", () => {
    expect(matches("mediamtx", "/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml")).toBe(true);
    expect(matches("ffmpeg", "ffmpeg -i x -f rtsp rtsp://127.0.0.1:8554/assembly-webrtc")).toBe(true);
    expect(matches("ffmpeg", "ffmpeg -i x out.mp4")).toBe(false);
  });
});
