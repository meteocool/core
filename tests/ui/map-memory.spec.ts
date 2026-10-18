import { expect, test } from "./test";
import { RADAR_VIEW, openRadar } from "./app";

/**
 * The flat map stays sharp on a phone: it is held under the web view's memory
 * limit by what it keeps (lib/idleLayers.ts), never by drawing at less than
 * the screen's resolution, as the 3D map is.
 */

test.skip(({ isMobile }) => !isMobile, "the app runs on phones");

test("in the app, the flat map draws at a 3x iPhone's full resolution", async ({ page }) => {
  await openRadar(page, `/ios.html${RADAR_VIEW.slice(1)}`);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(3);
  // OpenLayers scales its canvases with a transform, so they are measured against the map's own width.
  const ratios = await page.locator("#map .ol-viewport").evaluate((viewport) => [...viewport.querySelectorAll("canvas")]
    .filter((canvas) => canvas.width > 1)
    .map((canvas) => canvas.width / viewport.clientWidth));
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) expect(ratio).toBeCloseTo(3, 1);
});
