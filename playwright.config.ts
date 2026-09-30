import { defineConfig } from "@playwright/test";
import { CHROMIUM, E2E } from "./e2e/env";

// Browser tests against a production build of the panel, a test MediaMTX and no OBS.
// Run with `pnpm test:e2e`; needs mediamtx, ffmpeg and an installed Chrome/Chromium.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  // The panel and the test stream are shared state; run one test at a time.
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E.panel,
    browserName: "chromium",
    launchOptions: {
      executablePath: CHROMIUM,
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: `pnpm build && pnpm exec next start -H 127.0.0.1 -p ${E2E.panelPort}`,
    url: `${E2E.panel}/api/watch`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      AV_MEDIAMTX_API: E2E.mediamtxApi,
      AV_MEDIAMTX_HLS: "http://127.0.0.1:1",
      AV_WEBRTC_PORT: String(E2E.webrtcPort),
      AV_VIEWER_PORT: String(E2E.viewerPort),
      AV_RTSP_BASE: E2E.rtsp,
      // No OBS in the tests, and nothing that could touch a real one.
      AV_OBS_WS_URL: "ws://127.0.0.1:1",
      AV_OBS_CONFIG_DIR: `${E2E.stateDir}/obs`,
      AV_STATE_DIR: E2E.stateDir,
      // Never start a real MediaMTX, and don't mistake a running one for the panel's.
      AV_MEDIAMTX_BIN: "/nonexistent/mediamtx-e2e",
    },
  },
});
