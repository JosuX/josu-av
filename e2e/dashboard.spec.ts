import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { expectPlaying } from "./helpers";

test("the dashboard plays the feed and gets live pushes instead of polling", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));

  await page.goto("/");
  await expect(page.getByText("Live feed")).toBeVisible();
  await expectPlaying(page);
  await page.waitForTimeout(8000);

  expect(requests).toContain("/api/events/status");
  // One read on load; everything after that arrives over the event stream.
  expect(requests.filter((p) => p === "/api/status").length).toBeLessThanOrEqual(1);
});

test("viewers on the watch page are detected and their playback analysed", async ({ browser }) => {
  const viewer = await browser.newPage();
  await viewer.goto(`${E2E.viewer}/watch`);
  await expectPlaying(viewer);

  const dashboard = await browser.newPage();
  await dashboard.goto("/");
  const row = dashboard.getByRole("listitem").filter({ hasText: "(watch page)" });
  await expect(row).toBeVisible();
  // Judged once 15 s of reports are in.
  await expect(row).toContainText("Smooth", { timeout: 60_000 });
  await expect(row).toContainText("kbps");

  // The dashboard's own player is a viewer too.
  await expect(dashboard.getByRole("listitem").filter({ hasText: "(dashboard)" })).toBeVisible();

  await viewer.close();
  await dashboard.close();
});

test("without OBS, Settings explains how to connect and offers to launch it", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Not connected to OBS")).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch OBS" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adaptive bitrate" })).toBeVisible();
});
