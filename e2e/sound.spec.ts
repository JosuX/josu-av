import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { expectPlaying } from "./helpers";

const isMuted = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.querySelector("video")!.muted);

test("the watch page starts with sound when the browser allows it", async ({ page }) => {
  // The suite's browser allows autoplay with sound, like a desktop browser that knows the site.
  await page.goto(`${E2E.viewer}/watch`);
  await expectPlaying(page);
  expect(await isMuted(page)).toBe(false);
  await expect(page.getByText("Tap for sound")).toHaveCount(0);
});

test("when the browser blocks sound, the watch page plays muted and the first tap turns sound on", async ({ page }) => {
  // Headless Chromium lets WebRTC play with sound whatever its autoplay flag (and its user
  // activation state isn't reliable here), so recreate a phone's rule directly: sound only
  // after the person has tapped or pressed a key on the page.
  await page.addInitScript(() => {
    let interacted = false;
    for (const type of ["pointerdown", "keydown"])
      window.addEventListener(type, () => (interacted = true), { capture: true, once: true });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !interacted)
        return Promise.reject(new DOMException("play() with sound needs a user gesture", "NotAllowedError"));
      return play.call(this);
    };
  });
  await page.goto(`${E2E.viewer}/watch`);
  await expectPlaying(page);
  expect(await isMuted(page)).toBe(true);
  await expect(page.getByText("Tap for sound")).toBeVisible();

  // A tap anywhere counts, not only on the prompt.
  await page.mouse.click(20, 20);
  await expect.poll(() => isMuted(page)).toBe(false);
  await expect(page.getByText("Tap for sound")).toHaveCount(0);
  await expectPlaying(page);
});

test("the dashboard's own player stays muted", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-slot="card"]').filter({ hasText: "Live feed" }).getByRole("radio", { name: "/assembly" }).click();
  await expectPlaying(page);
  expect(await isMuted(page)).toBe(true);
});
