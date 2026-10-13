import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, preloadedShares, timeline, wholePreloadBand } from "./app";

/**
 * Every frame of the timeline fetched ahead for the map in view, once the
 * reader starts moving through frames, each step's slot filling as its tiles
 * arrive (lib/framePreload.ts). Offline every tile is answered at once,
 * blank, so the whole strip fills.
 */

/** Every distinct tile the page asks for. */
function tilesAsked(page: Page): Set<string> {
  const asked = new Set<string>();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/tiles/")) asked.add(request.url());
  });
  return asked;
}

test("a page opened to look at now fetches no other frames, and the timeline shows no fill", async ({ page }) => {
  await openRadar(page);
  await page.waitForTimeout(3000);
  expect((await preloadedShares(page)).every((share) => share === 0)).toBe(true);
  await expect(wholePreloadBand(page)).toHaveCount(0);
});

test("a step back on the timeline fetches every frame, and the strip fills", async ({ page }) => {
  const tiles = tilesAsked(page);
  await openRadar(page);
  const before = tiles.size;
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  const playable = Number(await timeline(page).getAttribute("aria-valuemax")) + 1;
  await expect.poll(async () => (await preloadedShares(page)).every((share) => share === 1), { timeout: 20_000 }).toBe(true);
  // One piece of glass, to the end of the strip at +2h, past the last frame published.
  await expect(wholePreloadBand(page)).toHaveCount(1);
  const band = (await wholePreloadBand(page).boundingBox())!;
  const strip = (await timeline(page).boundingBox())!;
  expect(Math.abs(band.x + band.width - (strip.x + strip.width))).toBeLessThan(1);
  // Fetched ahead, not merely drawn: many more tiles than the two frames shown.
  expect(tiles.size - before).toBeGreaterThan(playable);
});

test("with preloading off, a step back fetches nothing ahead and the strip shows no fill", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("precacheForecast", "false"));
  await openRadar(page);
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(3000);
  expect((await preloadedShares(page)).every((share) => share === 0)).toBe(true);
});
