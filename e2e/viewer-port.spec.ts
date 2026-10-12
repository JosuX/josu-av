import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { expectPlaying, rawStatus } from "./helpers";

test("the viewer port opens the watch page, which plays the stream", async ({ page }) => {
  await page.goto(`${E2E.viewer}/`);
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page).toHaveTitle("Live stream");
  await expect(page.locator("header")).toHaveCount(0);
  await expectPlaying(page);
});

test("the viewer port refuses every control page and endpoint", async () => {
  const denied: [string, string, string?][] = [
    ["GET", "/settings"],
    ["GET", "/logs"],
    ["GET", "/api/status"],
    ["GET", "/api/obs"],
    ["GET", "/api/automation"],
    ["GET", "/api/events/status"],
    ["GET", "/api/logs/mediamtx"],
    ["POST", "/api/process/mediamtx", '{"action":"stop"}'],
    ["POST", "/api/obs", '{"action":"restart-stream"}'],
    ["POST", "/api/automation", '{"launchObs":true}'],
    ["POST", "/api/abr", '{"bitrate":1000}'],
    ["GET", "/_next/static/../../settings"],
    ["GET", "/_next/static/%2e%2e/%2e%2e/api/status"],
    ["GET", "//settings"],
  ];
  for (const [method, path, body] of denied)
    expect(await rawStatus(E2E.viewerPort, method, path, body), `${method} ${path}`).toBe(404);

  // ...while the same control page works on the panel's own port.
  expect(await rawStatus(E2E.panelPort, "GET", "/settings")).toBe(200);
});

test("the viewer port refuses oversized bodies", async ({ request }) => {
  const res = await request.post(`${E2E.viewer}/api/viewers`, { data: "x".repeat(64 * 1024) });
  expect(res.status()).toBe(413);
});

test("control endpoints refuse writes from other sites", async ({ request }) => {
  const res = await request.post(`${E2E.panel}/api/process/mediamtx`, {
    headers: { Origin: "https://evil.example" },
    data: { action: "stop" },
  });
  expect(res.status()).toBe(403);
});
