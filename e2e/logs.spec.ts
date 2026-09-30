import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { expectPlaying } from "./helpers";

test("the Log Monitor has Clients, OBS and Automation views next to MediaMTX", async ({ page }) => {
  await page.goto("/logs");
  // Each console also has its own All/Issues filter, so match the view names exactly.
  for (const name of ["All logs", "MediaMTX", "Clients", "OBS", "Automation"])
    await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();

  await page.getByRole("radio", { name: "OBS", exact: true }).click();
  await expect(page).toHaveURL(/view=obs/);
  await expect(page.getByText(/Nothing from OBS yet/)).toBeVisible();
});

test("the Clients log records viewers joining, their playback and MediaMTX sessions", async ({ browser, request }) => {
  // Earlier tests' viewers are in the log too; start empty so only this test's events count.
  await request.post("/api/logs/clients", { data: { action: "clear" } });
  const logs = await browser.newPage();
  await logs.goto("/logs?view=clients");
  const log = logs.getByRole("log");
  await expect(logs.getByText(/No viewers yet/)).toBeVisible();

  const viewer = await browser.newPage();
  await viewer.goto(`${E2E.viewer}/watch`);
  await expectPlaying(viewer);

  await expect(log).toContainText("Viewer joined:");
  await expect(log).toContainText("(watch page)");
  await expect(log).toContainText(/Player \S+ \(WebRTC, \/assembly\) (is )?connected/);
  await expect(log).toContainText("playing smoothly", { timeout: 60_000 });

  await viewer.close();
  await expect(log).toContainText("Viewer left:", { timeout: 40_000 });
  await expect(log).toContainText("disconnected after");

  await logs.getByRole("button", { name: "Clear log" }).click();
  await expect(logs.getByText(/No viewers yet/)).toBeVisible();
  await logs.close();
});
