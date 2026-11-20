import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { noGeocoder } from "./app";

/**
 * The flight's own page: meteoair.html, and the web app opened at
 * `#meteoair`. The radar map with nothing of the app's over it, the page's
 * words, and on a desktop the way into the flight's plan and back.
 */
const VIEW = "latLonZ=50.50000,9.50000,6.00";

const landing = (page: Page) => page.locator(".landing");
const board = (page: Page) => page.getByRole("button", { name: "Plan a flight" });
const appChrome = (page: Page) =>
  page.locator(".top-left, .bottomToolbar, .lsToggle, .live-wrapper, .ol-zoom, .ol-geolocate, .ol-share").filter({ visible: true });

for (const path of [`/meteoair.html?${VIEW}`, `/?${VIEW}#meteoair`]) {
  test(`${path.split("?")[0]}${path.includes("#") ? "#meteoair" : ""} is the flight's page, over a map without the app's chrome`,
    async ({ page }, testInfo) => {
      await page.goto(path);
      await expect(landing(page)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Fly an airliner");
      await expect(page.locator("#map canvas").first()).toBeVisible();
      await expect(appChrome(page)).toHaveCount(0);
      await expect(page.locator(".ol-attribution")).toContainText("OpenStreetMap");
      // The address stays the page's own: nothing of the map is written into it.
      expect(new URL(page.url()).search).toBe(`?${VIEW}`);
      if (testInfo.project.name === "desktop") await expect(board(page)).toBeVisible();
      else {
        // A phone has no flight to offer, and says why.
        await expect(board(page)).toHaveCount(0);
        await expect(landing(page)).toContainText("flies on a desktop");
      }
    });
}

test("the button opens the flight's plan, and the plan put away is the page again", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the flight is a desktop's");
  // The 3D map's first bring-up and Studio's chunk, both under this one test.
  test.setTimeout(120_000);
  await noGeocoder(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await board(page).click();
  const plan = page.getByRole("region", { name: "Flight plan" });
  await expect(plan).toBeVisible({ timeout: 60_000 });
  await expect(landing(page)).toHaveCount(0);
  // Studio's own tools are not this page's.
  await expect(page.getByRole("button", { name: "Take off" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(landing(page)).toBeVisible({ timeout: 30_000 });
  await expect(plan).toHaveCount(0, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).lm.currentCap)).toBe("radar");
});

test("a hash that starts asking for the flight's page loads it", async ({ page }) => {
  await page.goto(`/?${VIEW}`);
  await expect(page.locator("#map canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(landing(page)).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "#meteoair"; });
  await expect(landing(page)).toBeVisible({ timeout: 30_000 });
});
