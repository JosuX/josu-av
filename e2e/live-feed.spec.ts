import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { expectPlaying } from "./helpers";

test("the Live feed card switches between /assembly and /watch, with matching links", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-slot="card"]').filter({ hasText: "Live feed" });
  const open = card.getByRole("link", { name: /^Open / });

  // /assembly: the path straight from MediaMTX.
  await expect(card.getByRole("radio", { name: "/assembly" })).toHaveAttribute("data-state", "on");
  await expectPlaying(page);
  await expect(open).toHaveAttribute("href", new RegExp(`:${E2E.webrtcPort}/assembly$`));

  // /watch: the viewer page embedded, playing, and the link follows.
  await card.getByRole("radio", { name: "/watch" }).click();
  const iframe = card.locator('iframe[title="Viewer page"]');
  await expect(iframe).toHaveAttribute("src", new RegExp(`:${E2E.viewerPort}/watch\\?muted=1$`));
  await expect(open).toHaveAttribute("href", new RegExp(`:${E2E.viewerPort}/watch$`));
  const frame = page.frames().find((f) => f.url().includes(`:${E2E.viewerPort}/`)) ?? (await (await iframe.elementHandle())!.contentFrame())!;
  await frame.waitForFunction(() => {
    const v = document.querySelector("video");
    return !!v && v.videoWidth > 0 && v.currentTime > 1;
  });
  // The preview never starts playing sound inside the control panel.
  expect(await frame.evaluate(() => document.querySelector("video")!.muted)).toBe(true);

  // The choice sticks across reloads.
  await page.reload();
  await expect(card.getByRole("radio", { name: "/watch" })).toHaveAttribute("data-state", "on");
});

test("the Live feed card shows stream stats and a viewer breakdown", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-slot="card"]').filter({ hasText: "Live feed" });
  await card.getByRole("radio", { name: "/assembly" }).click();
  await expectPlaying(page);

  await expect(card.getByText("H264 · Opus")).toBeVisible();
  await expect(card.locator("dd").filter({ hasText: /^\d+s$|^\d+m/ }).first()).toBeVisible(); // live for
  await expect(card.locator("dd").filter({ hasText: /^\d+ kbps$/ }).first()).toBeVisible(); // bitrate in
  await expect(card.getByText("640×360 @ 30")).toBeVisible(); // reported by the player
  await expect(card.getByText(/^Dashboard\s*1$/)).toBeVisible();
});

test("Share shows the viewer page's LAN link and a QR code", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Share the viewer page" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("textbox")).toHaveValue(new RegExp(`^http://[^/]+:${E2E.viewerPort}/$`));
  // Opened as 127.0.0.1, the link must use an address other devices can reach.
  await expect(dialog.getByRole("textbox")).not.toHaveValue(/127\.0\.0\.1|localhost/);
  await expect(dialog.getByRole("img", { name: /QR code/ })).toBeVisible();
});
