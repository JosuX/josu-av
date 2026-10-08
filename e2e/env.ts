import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Ports and paths for the browser tests, chosen so they run alongside a real panel and MediaMTX.
export const E2E = {
  panelPort: 3290,
  viewerPort: 18080,
  mediamtxApi: "http://127.0.0.1:19997",
  rtsp: "rtsp://127.0.0.1:18554",
  webrtcPort: 18889,
  stateDir: path.join(tmpdir(), "av-control-e2e"),
  get panel() {
    return `http://127.0.0.1:${this.panelPort}`;
  },
  get viewer() {
    return `http://127.0.0.1:${this.viewerPort}`;
  },
};

/**
 * The test stream is H.264, which Playwright's own Chromium can't decode (no proprietary
 * codecs), so use an installed Chrome/Chromium. Override with E2E_CHROMIUM.
 */
export const CHROMIUM =
  process.env.E2E_CHROMIUM ??
  [
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((dir) => path.join(dir!, "Google", "Chrome", "Application", "chrome.exe")),
  ].find((p) => existsSync(p));
