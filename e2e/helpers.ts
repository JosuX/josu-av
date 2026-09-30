import http from "node:http";
import { expect, type Page } from "@playwright/test";

/** Wait until the page's video shows frames and keeps playing. */
export async function expectPlaying(page: Page) {
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return !!v && v.videoWidth > 0 && v.currentTime > 1;
  });
  const t1 = await page.evaluate(() => document.querySelector("video")!.currentTime);
  await page.waitForTimeout(1500);
  const t2 = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(t2).toBeGreaterThan(t1);
}

/**
 * A raw HTTP request, so paths reach the server exactly as written (fetch and Playwright
 * normalise "..", which would hide path tricks).
 */
export function rawStatus(port: number, method: string, path: string, body?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: body ? { "Content-Type": "application/json" } : {} },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        res.destroy();
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
