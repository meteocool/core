import { expect, test } from "./test";
import { flatPixel, openRadar } from "./app";

for (const rebuildView of [false, true]) {
  for (const latitude of [-80, 80]) {
    test(`latitude ${latitude} stays visible${rebuildView ? " after changing rotation" : ""}`, async ({ page }) => {
      await openRadar(page, `/?layer=radar&latLonZ=${latitude},10.00000,6.00`);
      if (rebuildView) {
        await page.evaluate(() => window.settings.set("mapRotation", true));
      }

      const point = await flatPixel(page, 10, latitude);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(page.viewportSize()!.height);
    });
  }

  test(`the map cannot pan into a repeated world${rebuildView ? " after changing rotation" : ""}`, async ({ page }) => {
    await openRadar(page);
    if (rebuildView) {
      await page.evaluate(() => window.settings.set("mapRotation", true));
    }

    const longitudes = await page.evaluate(() => {
      const view = window.lm.getCurrentMap()!.getView();
      const worldWidth = 2 * Math.PI * 6378137;
      return [1, -2].map((worlds) => {
        view.adjustCenter([worlds * worldWidth, 0]);
        // Keep the raw longitude: toLonLat wraps it and hides repeated worlds.
        return view.getCenter()![0] / worldWidth * 360;
      });
    });
    for (const longitude of longitudes) {
      expect(longitude).toBeGreaterThanOrEqual(-180);
      expect(longitude).toBeLessThanOrEqual(180);
    }
  });

  test(`the map pans north of 62 degrees${rebuildView ? " after changing rotation" : ""}`, async ({ page }) => {
    await openRadar(page, "/?layer=radar&latLonZ=55.00000,10.00000,5.00");
    if (rebuildView) {
      await page.evaluate(() => window.settings.set("mapRotation", true));
    }

    const { width, height } = page.viewportSize()!;
    for (let drag = 0; drag < 3; drag += 1) {
      await page.mouse.move(width / 2, height * 0.18);
      await page.mouse.down();
      await page.mouse.move(width / 2, height * 0.55, { steps: 12 });
      await page.waitForTimeout(200);
      await page.mouse.up();
      await expect.poll(() => page.evaluate(() => {
        const view = window.lm.getCurrentMap()!.getView();
        return view.getAnimating() || view.getInteracting();
      })).toBe(false);
    }

    await expect.poll(() => Number(new URL(page.url()).searchParams.get("latLonZ")?.split(",")[0]))
      .toBeGreaterThan(62);
  });
}
