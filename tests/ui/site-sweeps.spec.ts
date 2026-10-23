import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "./test";
import { noGeocoder, openRadar, settled } from "./app";
import type { Page } from "@playwright/test";

/**
 * Site mode: a radar's mark on the flat map opens that radar's own sweep,
 * with a tray to choose what and which tilt, over the composites dimmed.
 *
 * `/sweeps` is answered from a fixture written by hand
 * (fixtures/api/GET_sweeps.json): neither staging nor demo served the route
 * when this was written. The sweeps themselves are tiles, answered blank,
 * so the tray says the sweep could not be loaded; the tilts are the
 * listing's.
 */
const CENTRAL_GERMANY = "/?layer=radar&latLonZ=50.20000,9.20000,7.20";


/** The page pixel of a radar's mark, once the marks are drawn. */
const markOf = (page: Page, site: string) => page.evaluate((code) => {
  const map = (window as any).lm.getCurrentMap();
  const marks = map?.getAllLayers().find((layer: any) => layer.getSource?.()?.getFeatures?.()
    ?.some((feature: any) => feature.get("radarSite")));
  if (!marks?.getVisible()) return null;
  const feature = marks.getSource().getFeatures().find((candidate: any) => candidate.get("radarSite") === code);
  if (!feature) return null;
  const [x, y] = map.getPixelFromCoordinate(feature.getGeometry().getCoordinates());
  const rect = map.getViewport().getBoundingClientRect();
  const at = { x: rect.left + x, y: rect.top + y };
  const top = document.elementFromPoint(at.x, at.y);
  return top && map.getViewport().contains(top) ? at : null;
}, site);

/** How strongly DWD's composite is drawn. */
const compositeOpacity = (page: Page) => page.evaluate(() => (window as any).radar?.layer?.getOpacity() ?? null);

test("the radars' marks are off until turned on in Settings", async ({ page }) => {
  await noGeocoder(page);
  await openRadar(page, CENTRAL_GERMANY);
  await expect.poll(() => compositeOpacity(page), { timeout: 20_000 }).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("layerSites"))).toBeNull();
  expect(await markOf(page, "deoft")).toBeNull();
});

test.describe("with the radars' marks on", () => {
  // The setting is off by default; every test below turns it on.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("layerSites", "true"));
  });

  test("a radar's mark opens its sweep, lists its tilts, and closing gives the composites back", async ({ page }) => {
    await noGeocoder(page);
    await openRadar(page, CENTRAL_GERMANY);
    await expect.poll(() => markOf(page, "deoft"), { timeout: 20_000 }).not.toBeNull();
    await expect.poll(() => compositeOpacity(page), { timeout: 20_000 }).not.toBeNull();
    const before = (await compositeOpacity(page))!;

    const at = (await markOf(page, "deoft"))!;
    await page.mouse.click(at.x, at.y);

    const tray = page.getByRole("group", { name: "Offenthal radar" });
    await settled(tray);
    const tilts = tray.getByRole("combobox", { name: "Tilt" });
    await expect(tilts.locator("option")).toHaveCount(6);
    await expect(tilts.locator("option").first()).toHaveText(/^0\.5° · /);
    await expect.poll(() => compositeOpacity(page)).toBeCloseTo(before * 0.35, 5);

    // Velocity is offered, the site having published it.
    await tray.getByRole("radio", { name: "Velocity", exact: true }).click();
    await expect(tray.getByRole("radio", { name: "Velocity", exact: true })).toBeChecked();
    await expect(tray.getByRole("combobox", { name: "Tilt" }).locator("option")).toHaveCount(6);

    await tray.getByRole("button", { name: "Close the radar" }).click();
    await expect(tray).toBeHidden();
    await expect.poll(() => compositeOpacity(page)).toBeCloseTo(before, 5);
  });

  /**
   * The same with real sweeps behind the listing: Borkum's (deasb) 0.5 degree tilt of
   * 2026-10-09 18:20, from staging's archive, published by worker-analysis
   * (fixtures/sweeps). Whatever the listing names, these two objects answer.
   */
  const EMDEN = "/?layer=radar&latLonZ=53.70000,6.90000,8.20";

  test("a real sweep is drawn, says when it was scanned and that it was dealiased, and the hold reads it", async ({ page }) => {
    await noGeocoder(page);
    await page.route("**/meteoradar/sweeps/**", (route) => {
      const quantity = route.request().url().endsWith("VRADH.mcsw") ? "VRADH" : "DBZH";
      // Unwrapped here: a fulfilled route skips the browser's own gunzip,
      // which is what `Content-Encoding: gzip` buys from the bucket.
      const body = gunzipSync(readFileSync(`tests/ui/fixtures/sweeps/${quantity}.mcsw`));
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    });
    await openRadar(page, EMDEN);
    await expect.poll(() => markOf(page, "deasb"), { timeout: 20_000 }).not.toBeNull();
    const at = (await markOf(page, "deasb"))!;
    await page.mouse.click(at.x, at.y);

    const tray = page.getByRole("group", { name: "Borkum radar" });
    await settled(tray);
    await expect(tray.getByText(/^Scanned \d\d?:\d\d:\d\d/)).toBeVisible({ timeout: 15_000 });
    const drawn = () => page.evaluate(() => {
      const map = (window as any).lm.getCurrentMap();
      const layer = map.getAllLayers().find((candidate: any) => candidate.getZIndex() === 85);
      return layer?.getVisible() ?? false;
    });
    await expect.poll(drawn).toBe(true);

    await tray.getByRole("radio", { name: "Velocity", exact: true }).click();
    await expect(tray.getByText("Dealiased", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Hold 20 km north-east of the radar, inside the sweep: the menu reads the bin.
    const box = await page.locator("#map").boundingBox();
    const target = await page.evaluate(() => {
      const map = (window as any).lm.getCurrentMap();
      const x = (6.95 * Math.PI * 6378137) / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + (53.72 * Math.PI) / 360)) * 6378137;
      const [px, py] = map.getPixelFromCoordinate([x, y]);
      const rect = map.getViewport().getBoundingClientRect();
      return { x: rect.left + px, y: rect.top + py };
    });
    expect(box).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await expect(page.locator(".site-reading .where")).toHaveText(/° · \d+\.\d km · beam \d+\.\d km$/, { timeout: 10_000 });
  });
});
