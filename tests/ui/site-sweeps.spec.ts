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
