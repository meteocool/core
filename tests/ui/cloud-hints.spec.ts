import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { noGeocoder, openRadar } from "./app";
import { volumesBehind } from "./storms";

/**
 * The flat map's "3D" tags for storms a scan behind the radar: France's
 * volumes put a scan behind its radar. Wherever the recording's storms are,
 * each greyed tag is brought to the middle of the screen in turn.
 */
const FRANCE_VIEW = "/?layer=radar&latLonZ=45.00000,3.50000,9.00";

/** Where the greyed tags are, in the map's coordinates. */
const greyedTags = (page: Page): Promise<number[][]> => page.evaluate(() => {
  const map = (window as any).lm.getCurrentMap();
  const hints = map?.getAllLayers().find((layer: any) => layer.getSource?.()?.getFeatures?.()
    ?.some((feature: any) => feature.get("cloud")));
  return (hints?.getSource().getFeatures() ?? [])
    .filter((feature: any) => feature.get("stale") === true)
    .map((feature: any) => feature.getGeometry().getCoordinates());
});

test("a storm a scan behind the radar keeps its 3D tag, which still opens it in 3D", async ({ page }) => {
  await noGeocoder(page);
  await volumesBehind(page, "fr");
  await openRadar(page, FRANCE_VIEW);
  // A greyed tag on screen, clear of any storm a tap would open instead, and
  // not under the page's own controls.
  const where = () => page.evaluate(() => {
    const map = (window as any).lm.getCurrentMap();
    if (!map) return null;
    const hints = map.getAllLayers().find((layer: any) => layer.getSource?.()?.getFeatures?.()
      ?.some((feature: any) => feature.get("cloud")));
    if (!hints?.getVisible()) return null;
    const rect = map.getViewport().getBoundingClientRect();
    for (const feature of hints.getSource().getFeatures()) {
      if (feature.get("stale") !== true) continue;
      const [x, y] = map.getPixelFromCoordinate(feature.getGeometry().getCoordinates());
      // The middle of the pill: 8 px right of and above the core, 34 by 18.
      const pixel = [x + 25, y - 17];
      const tag = map.forEachFeatureAtPixel(pixel, (hit: any) => hit, { layerFilter: (layer: any) => layer === hints });
      const storm = map.forEachFeatureAtPixel(pixel, (hit: any) => hit.get("storm"), { hitTolerance: 6 });
      const at = { x: rect.left + pixel[0], y: rect.top + pixel[1] };
      const top = document.elementFromPoint(at.x, at.y);
      if (tag === feature && !storm && top && map.getViewport().contains(top)) return at;
    }
    return null;
  });
  await expect.poll(async () => (await greyedTags(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  let at: { x: number; y: number } | null = null;
  for (const tag of await greyedTags(page)) {
    await page.evaluate((centre) => (window as any).lm.getCurrentMap().getView().setCenter(centre), tag);
    at = await expect.poll(where, { timeout: 2_000 }).not.toBeNull().then(() => where(), () => null);
    if (at) break;
  }
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await expect(page).toHaveURL(/layer=cells3d/, { timeout: 15_000 });
});
