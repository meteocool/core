import type { Page } from "@playwright/test";
import { expect, test } from "./test";

/**
 * The 3D map's corner credits: on the web, where nothing else names the
 * sources; not in the apps, whose settings list every source and licence.
 */
const MAP_3D = "?layer=cells3d&latLonZ=50.50000,9.50000,7.00";

const credits = (page: Page) => page.locator(".maplibre-host .maplibregl-ctrl-attrib");

async function open3d(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator(".maplibre-host canvas").first()).toBeVisible({ timeout: 30_000 });
}

test("on the web, the 3D map credits its sources", async ({ page }) => {
  await open3d(page, `/${MAP_3D}`);
  await expect(credits(page)).toBeVisible();
  await expect(credits(page)).toContainText("OpenStreetMap");
});

test.describe("in the iOS app", () => {
  test.skip(({ isMobile }) => !isMobile, "the app runs on phones");

  test("the 3D map has no credits; the app's settings carry them", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "webkit", {
        value: { messageHandlers: { scriptHandler: { postMessage: () => undefined } } },
      });
    });
    await open3d(page, `/ios.html${MAP_3D}`);
    // Long enough for MapLibre to have added the control if it were going to.
    await page.waitForTimeout(1500);
    await expect(credits(page)).toHaveCount(0);
  });
});
