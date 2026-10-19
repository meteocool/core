import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { RADAR_VIEW, open3d, openRadar, overlaps, playButton, timeline } from "./app";

/**
 * The maps' corner credits: on the web, where nothing else names the
 * sources; not in the apps, whose settings list every source and licence.
 * On both maps they stand up the right edge, under the control column.
 */
const MAP_3D = "?layer=cells3d&latLonZ=50.50000,9.50000,7.00";

const credits = (page: Page) => page.locator(".maplibre-host .maplibregl-ctrl-attrib");
const flatCredits = (page: Page) => page.locator(".ol-attribution");

/** The right-hand column on the flat map, and the layer button at its head. */
const flatControls = (page: Page): Locator =>
  page.locator(".ol-zoom, .ol-geolocate, .ol-share, .ol-rotate:not(.ol-hidden), .lsToggle");

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

test("on the web, the 3D map credits its sources", async ({ page }) => {
  await open3d(page, `/${MAP_3D}`);
  await expect(credits(page)).toBeVisible();
  await expect(credits(page)).toContainText("OpenStreetMap");
});

test("on the web, the flat map's credits stand up the right edge, clear of the controls and the tray",
  async ({ page }) => {
    await openRadar(page);
    const attribution = flatCredits(page);
    await expect(attribution).toContainText("OpenStreetMap");
    await expect(attribution).toHaveCSS("writing-mode", "vertical-rl");

    const credit = await box(attribution);
    const width = page.viewportSize()!.width;
    expect(credit.x + credit.width).toBeGreaterThan(width - 4);
    expect(credit.height).toBeGreaterThan(credit.width);

    for (const control of await flatControls(page).all()) {
      if (!(await control.isVisible())) continue;
      expect(overlaps(credit, await box(control))).toBe(false);
    }
    const strip = await box(timeline(page));
    expect(credit.y + credit.height).toBeLessThanOrEqual(strip.y);
    expect(overlaps(credit, await box(playButton(page)))).toBe(false);
  });

test("every credit's link on the flat map takes a click", async ({ page }) => {
  await openRadar(page);
  const links = flatCredits(page).locator("a");
  expect(await links.count()).toBeGreaterThan(0);
  // Each line of a link, as one that wraps into the next column has two.
  const missed = await links.evaluateAll((anchors) => anchors.filter((a) => [...a.getClientRects()]
    .some(({ x, y, width, height }) => !a.contains(document.elementFromPoint(x + width / 2, y + height / 2))))
    .map((a) => a.textContent));
  expect(missed).toEqual([]);
});

test("the flat map's credits start where the 3D map's do", async ({ page }) => {
  await openRadar(page);
  const flat = await box(flatCredits(page));
  await open3d(page, `/${MAP_3D}`);
  await expect(credits(page)).toBeVisible();
  const deep = await box(credits(page));
  expect(Math.abs(flat.x + flat.width - (deep.x + deep.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(flat.y - deep.y)).toBeLessThanOrEqual(1);
});

test.describe("in the iOS app", () => {
  test.skip(({ isMobile }) => !isMobile, "the app runs on phones");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "webkit", {
        value: { messageHandlers: { scriptHandler: { postMessage: () => undefined } } },
      });
    });
  });

  test("the 3D map has no credits; the app's settings carry them", async ({ page }) => {
    await open3d(page, `/ios.html${MAP_3D}`);
    // Long enough for MapLibre to have added the control if it were going to.
    await page.waitForTimeout(1500);
    await expect(credits(page)).toHaveCount(0);
  });

  test("the flat map shows no credits either", async ({ page }) => {
    await openRadar(page, `/ios.html${RADAR_VIEW.slice(1)}`);
    await expect(flatCredits(page).getByText("OpenStreetMap")).toBeHidden();
  });
});
