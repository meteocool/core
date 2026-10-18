import { expect, test } from "./test";
import { RADAR_VIEW, openRadar } from "./app";

/**
 * What the flat map holds on a phone, where the web view is killed past its
 * memory limit: every canvas and GPU target it draws into grows with the
 * square of its pixel ratio.
 */

test.skip(({ isMobile }) => !isMobile, "the limit is a phone's");

test("in the app, the flat map draws at 2x on a 3x iPhone", async ({ page }) => {
  await openRadar(page, `/ios.html${RADAR_VIEW.slice(1)}`);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(3);
  // OpenLayers scales its canvases with a transform, so they are measured against the map's own width.
  const ratios = await page.locator("#map .ol-viewport").evaluate((viewport) => [...viewport.querySelectorAll("canvas")]
    .filter((canvas) => canvas.width > 1)
    .map((canvas) => canvas.width / viewport.clientWidth));
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) expect(ratio).toBeCloseTo(2, 1);
});
