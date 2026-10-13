import { expect, test } from "./test";
import { noGeocoder, openRadar } from "./app";

/**
 * The flat map's "3D" tags for storms a scan behind the radar. The recording
 * is one such moment: DWD's newest frame is 01:35, and Germany's volumes are
 * still 01:30's.
 */
const NORTH_GERMANY_VIEW = "/?layer=radar&latLonZ=54.00000,10.10000,9.00";

test("a storm a scan behind the radar keeps its 3D tag, which still opens it in 3D", async ({ page }) => {
  await noGeocoder(page);
  await openRadar(page, NORTH_GERMANY_VIEW);
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
  await expect.poll(where, { timeout: 20_000 }).not.toBeNull();
  const at = (await where())!;
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/layer=cells3d/, { timeout: 15_000 });
});
