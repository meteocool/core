import { expect, type Locator, type Page } from "@playwright/test";

/** Central Germany, where the demo storm's radar is: the radar map, at a country's zoom. */
export const RADAR_VIEW = "/?layer=radar&latLonZ=50.50000,9.50000,6.00";

/** Open the radar map and wait for the player, which opens by itself on it. */
export async function openRadar(page: Page, path = RADAR_VIEW): Promise<void> {
  await page.goto(path);
  await settled(timeline(page));
}

/**
 * Visible, and done moving. The tray flies in for 400 ms after it appears,
 * and a drag measured from where it was mid-flight starts on whatever has
 * since slid under that point.
 */
export async function settled(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const before = JSON.stringify(await locator.boundingBox());
    await new Promise((resolve) => setTimeout(resolve, 150));
    return before === JSON.stringify(await locator.boundingBox());
  }, { timeout: 10_000 }).toBe(true);
}

export const timeline = (page: Page): Locator => page.getByRole("slider", { name: "Radar timeline" });

/** The radar product control: a pill on a phone, the legend's caption on a desktop. */
export const productControl = (page: Page): Locator =>
  page.locator("button[aria-haspopup='menu'][title='Choose the radar product']:visible").first();

export const productMenu = (page: Page): Locator => page.getByRole("menu", { name: "Radar Product" });

export const backToNow = (page: Page): Locator => page.getByRole("button", { name: "Back to now" });

export const playButton = (page: Page): Locator => page.locator("button.controlButton.play");

/** Whether two boxes overlap, by more than a hairline. */
export function overlaps(a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

/** Where a [lon, lat] is on the flat map, in page pixels, once it is drawn. */
export async function flatPixel(page: Page, lon: number, lat: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([lng, lt]) => {
    const map = (window as any).lm.maps[0];
    const x = (lng * Math.PI * 6378137) / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + (lt * Math.PI) / 360)) * 6378137;
    const [px, py] = map.getPixelFromCoordinate([x, y]);
    const box = map.getViewport().getBoundingClientRect();
    return { x: box.left + px, y: box.top + py };
  }, [lon, lat]);
}

/** No place names offline: what asks for one (a storm's panel, the 3D map) goes without. */
export async function noGeocoder(page: Page): Promise<void> {
  await page.route("**/geocoding/**", (route) => route.fulfill({ status: 404, json: {} }));
  await page.route("https://api.bigdatacloud.net/**", (route) => route.fulfill({ status: 404, json: {} }));
}

/**
 * How full each step's slot on the timeline is with tiles fetched ahead, 0 to
 * 1, oldest first, the unpublished tail included. Drawn, not announced: read
 * off the fill's scale.
 */
export const preloadedShares = (page: Page): Promise<number[]> => page.locator(".strip .preloaded")
  .evaluateAll((rects) => rects.map((rect) => Number(/scaleY\(([\d.]+)\)/.exec((rect as SVGElement).style.transform)?.[1] ?? 0)));

/** The fetched-ahead band drawn as one piece of glass, once every frame is in. */
export const wholePreloadBand = (page: Page): Locator => page.locator(".strip .preload-glass.whole");

/** Open the 3D map at `path` and wait for its canvas. */
export async function open3d(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator(".maplibre-host canvas").first()).toBeVisible({ timeout: 30_000 });
}

/** The player's pill that turns the weather stations on and off. */
export const stationToggle = (page: Page): Locator => page.getByRole("button", { name: "Stations", exact: true });

/** The stations' parameter, a radio per choice, while they are on. */
export const stationPicker = (page: Page): Locator => page.getByRole("radiogroup", { name: "Station parameter" });

/** The page pixel of a radar's mark, once the marks are drawn; null while they are not. */
export const radarMark = (page: Page, site: string): Promise<{ x: number; y: number } | null> => page.evaluate((code) => {
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
