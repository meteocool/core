import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES, type RecordedResponse } from "./offline";
import { settled, timeline } from "./app";
import { patchOf, serveStorms, stormIdOf, stormOfVolume } from "./storms";
import { expect, test } from "./test";

/**
 * Both maps select a storm: a storm tapped on the flat map, a
 * box of sky tapped on the 3D map, and a link to a KONRAD3D cell all open
 * the storm they belong to, and the address names it as `storm=<id>`.
 *
 * The storms are stood in for from the recorded KONRAD3D tracks (storms.ts)
 * until a recording has them; the outside-Germany and 3D cases add a storm
 * only meteocool's tracker follows, made around a recorded volume.
 */

const recorded = (name: string) => (JSON.parse(
  readFileSync(path.join(FIXTURES, "api", `${name}.json`), "utf8"),
) as RecordedResponse).json as Record<string, any>;

const tracks = recorded("GET_cells_tracks").features as Record<string, any>[];
const volumes = recorded("GET_cells_volumes").volumes as Record<string, any>[];

/** A storm KONRAD3D rates, still going, with a name to go by. */
const cell = tracks.find((track) => track.properties.active && track.properties.placement)!;
const code: string = cell.properties.code;
const [cellLon, cellLat] = cell.geometry.coordinates[cell.geometry.coordinates.length - 1] as number[];

/** A storm's panel, by the label its section carries. */
const panel = (page: Page, name: string | RegExp) => page.getByRole("region", { name });

/** No place names offline: the panel is titled without one. */
async function noGeocoder(page: Page) {
  await page.route("**/geocoding/**", (route) => route.fulfill({ status: 404, json: {} }));
  await page.route("https://api.bigdatacloud.net/**", (route) => route.fulfill({ status: 404, json: {} }));
}

/** Where a [lon, lat] is on the flat map, in page pixels, once it is drawn. */
async function flatPixel(page: Page, lon: number, lat: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([lng, lt]) => {
    const map = (window as any).lm.maps[0];
    const x = (lng * Math.PI * 6378137) / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + (lt * Math.PI) / 360)) * 6378137;
    const [px, py] = map.getPixelFromCoordinate([x, y]);
    const box = map.getViewport().getBoundingClientRect();
    return { x: box.left + px, y: box.top + py };
  }, [lon, lat]);
}

test("tapping a storm on the flat map opens it, and the address names it", async ({ page, isMobile }) => {
  await page.goto(`/?layer=radar&latLonZ=${cellLat.toFixed(5)},${cellLon.toFixed(5)},9.00`);
  await settled(timeline(page));
  // Drawn once the storms are in; the storm's mark is where it is now.
  await expect.poll(() => page.evaluate((id) => Boolean((window as any).lm.maps[0].getLayers().getArray()
    .some((layer: any) => layer.getSource?.()?.getFeatureById?.(id))), stormIdOf(code)), { timeout: 15_000 }).toBe(true);
  const at = await flatPixel(page, cellLon, cellLat);
  await page.mouse.click(at.x, at.y);
  if (isMobile) {
    // A phone draws the storm first and says how to read about it.
    const details = page.getByRole("button", { name: /^Details/ });
    await expect(details).toBeVisible();
    await details.click();
  }
  await expect(panel(page, /storm$/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`storm=${stormIdOf(code)}`));
});

test("a link to a KONRAD3D cell opens the storm it belongs to, under the storm's name", async ({ page }) => {
  await page.route(`**/cells/tracks/${code}`, (route) => route.fulfill({ json: cell }));
  await page.goto(`/?layer=radar&cell=${code}`);
  const entries = await page.evaluate(() => window.history.length);
  await expect(panel(page, /storm$/)).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`storm=${stormIdOf(code)}`), { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("cell")).toBe(false);
  // The storm replaced the cell's entry rather than stacking one on it:
  // Back leaves the map instead of stepping from the storm to its cell.
  expect(await page.evaluate(() => window.history.length)).toBe(entries);
});

test("a storm outside Germany says plainly what is not known there", async ({ page }) => {
  const french = volumes.find((volume) => volume.network === "fr")!;
  const id = "01KFRANCESTANDBYSTRM000000";
  await serveStorms(page, [stormOfVolume(french, id)]);
  await noGeocoder(page);
  await page.goto(`/?layer=radar&storm=${id}`);
  const opened = panel(page, "Storm");
  await expect(opened).toBeVisible({ timeout: 30_000 });
  await expect(opened).toContainText("Outside DWD's storm analysis");
  // Its history is the tracker's, and there is no forecast to state.
  await expect(opened.getByRole("img", { name: /^Reflectivity/ })).toBeVisible();
  await expect(opened).not.toContainText("Forecast");
});

test("a link to a storm gone from the working set says so", async ({ page }) => {
  await page.goto("/?layer=radar&storm=01KGNEGNEGNEGNEGNEGNEGNEGN");
  await expect(page.getByText("That storm is no longer being tracked.")).toBeVisible({ timeout: 30_000 });
});

test("tapping a box of sky on the 3D map opens the storm it belongs to", async ({ page }) => {
  const box = volumes.find((volume) => volume.network === "de" && !volume.coarse && volume.tier === 2)!;
  const id = "01K3DSTANDBYSTRM0000000000";
  // The volumes name the patch each was cut from, as the backend's record does.
  const answer = recorded("GET_cells_volumes");
  await page.route("**/cells/volumes**", (route) => route.fulfill({
    json: { ...answer, volumes: answer.volumes.map((volume: Record<string, any>) => ({ ...volume, feature: patchOf(volume) })) },
  }));
  await serveStorms(page, [stormOfVolume(box, id)]);
  await noGeocoder(page);

  await page.goto(`/?layer=cells3d&latLonZ=${box.lat.toFixed(5)},${box.lon.toFixed(5)},10.00&pitch=0&bearing=0`);
  await expect(page.locator(".maplibre-host canvas").first()).toBeVisible({ timeout: 30_000 });
  // The boxes are hit-tested once drawn, and the map takes taps once the
  // veil over its bring-up has lifted; until then a tap finds nothing.
  const where = () => page.evaluate(([lon, lat]) => {
    const gl = (window as any).lm.getCapability("cells3d").gl;
    if (!gl?.getLayer("cloud-hit")) return null;
    const point = gl.project([lon, lat]);
    if (!gl.queryRenderedFeatures(point, { layers: ["cloud-hit"] }).length) return null;
    const canvas = gl.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const at = { x: rect.left + point.x, y: rect.top + point.y };
    return document.elementFromPoint(at.x, at.y) === canvas ? at : null;
  }, [box.lon, box.lat]);
  await expect.poll(where, { timeout: 20_000 }).not.toBeNull();
  const at = (await where())!;
  await page.mouse.click(at.x, at.y);

  const opened = panel(page, "Storm");
  await expect(opened).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`storm=${id}`), { timeout: 15_000 });
  await expect(opened).toContainText("DWD's storm analysis does not report this storm");
});
