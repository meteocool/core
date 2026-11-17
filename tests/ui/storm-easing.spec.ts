import type { Page } from "@playwright/test";
import { settled, timeline } from "./app";
import { recordedStorms } from "./storms";
import { expect, test } from "./test";

/**
 * Storms change without snapping: when a new answer has a storm somewhere
 * else, its mark slides there; a storm that is gone fades out and is then
 * gone; and with reduced motion, both happen at once.
 *
 * Over the Gulf of Lion, where the recording's storms are. The first answer
 * is the recording; every later one has the strong storm a few kilometres
 * east and the quiet one gone. A pan off what was fetched asks again.
 */

const stormBy = (suffix: string) => recordedStorms().map(({ storm }) => storm).find((storm) => storm.id.endsWith(suffix))!;

const STRONG = stormBy("AJYXQB");
const QUIET = stormBy("60RP0J");

/** How far east the strong storm moves, in degrees: about 4 km there. */
const SHIFT = 0.05;

/** The recorded answer, then one with the strong storm moved and the quiet one gone. */
async function serveAMove(page: Page): Promise<void> {
  const storms = recordedStorms().map(({ storm }) => storm);
  const moved = storms
    .filter((storm) => storm.id !== QUIET.id)
    .map((storm) => {
      if (storm.id !== STRONG.id) return storm;
      const shift = (c: number[]) => [c[0] + SHIFT, c[1]];
      const { path } = storm.properties;
      const coordinates = path.type === "LineString"
        ? [...path.coordinates, shift(storm.geometry.coordinates)]
        : [storm.geometry.coordinates, shift(storm.geometry.coordinates)];
      return {
        ...storm,
        geometry: { ...storm.geometry, coordinates: shift(storm.geometry.coordinates) },
        properties: { ...storm.properties, path: { type: "LineString", coordinates } },
      };
    });
  let answers = 0;
  await page.route(/\/storms(\?|$)/, (route) => {
    if (new URL(route.request().url()).pathname !== "/storms") return route.fallback();
    answers += 1;
    return route.fulfill({ json: { type: "FeatureCollection", features: answers === 1 ? storms : moved } });
  });
}

/**
 * Record, every frame from now on, where the strong storm's mark is drawn
 * and how strongly the quiet one's is, and whether anything is leaving.
 */
const watch = (page: Page, strong: string, quiet: string) => page.evaluate(([strongId, quietId]) => {
  const layers = (window as any).lm.maps[0].getLayers().getArray();
  const cells = layers.find((layer: any) => layer.getZIndex() === 202).getSource();
  const frames: { x: number | null; quiet: number | null; leaving: number }[] = [];
  (window as any).stormFrames = frames;
  const tick = () => {
    const features = cells.getFeatures();
    const strongMark = cells.getFeatureById(strongId);
    const quietMark = features.find((feature: any) => String(feature.getId()).startsWith(quietId));
    frames.push({
      x: strongMark ? strongMark.getGeometry().getCoordinates()[0] : null,
      quiet: quietMark ? (quietMark.get("fade") ?? 1) : null,
      leaving: features.filter((feature: any) => feature.get("leaving")).length,
    });
    if (frames.length < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, [strong, quiet]);

const frames = (page: Page) => page.evaluate(() => (window as any).stormFrames as { x: number | null; quiet: number | null; leaving: number }[]);

/** Where the strong storm is drawn, in map x, from where it was. */
const strongX = (page: Page) => page.evaluate((id) => {
  const layers = (window as any).lm.maps[0].getLayers().getArray();
  const mark = layers.find((layer: any) => layer.getZIndex() === 202).getSource().getFeatureById(id);
  return mark ? mark.getGeometry().getCoordinates()[0] as number : null;
}, STRONG.id);

/** Open the map on the storms, and pan off what was fetched so they are asked for again. */
async function openThenAskAgain(page: Page): Promise<{ from: number; to: number }> {
  const [lon, lat] = STRONG.geometry.coordinates;
  await page.goto(`/?layer=radar&latLonZ=${lat.toFixed(5)},${lon.toFixed(5)},10.00`);
  await settled(timeline(page));
  await expect.poll(() => strongX(page), { timeout: 15_000 }).not.toBeNull();
  const from = (await strongX(page))!;
  // 4 km east, in metres of the map's projection at this latitude: what the mark should end at.
  const to = from + (SHIFT * Math.PI * 6378137) / 180;
  await watch(page, STRONG.id, QUIET.id);
  await page.evaluate(() => {
    const view = (window as any).lm.maps[0].getView();
    const [x, y] = view.getCenter();
    view.setCenter([x + 200_000, y]);
  });
  return { from, to };
}

test("a storm that moved slides to where it is now, and one that is gone fades out and is gone", async ({ page }) => {
  await serveAMove(page);
  const { from, to } = await openThenAskAgain(page);
  await expect.poll(() => strongX(page), { timeout: 15_000 }).toBeCloseTo(to, 0);
  // Where it ends: the strong storm at its new place, the quiet one gone, nothing left fading.
  await expect.poll(async () => (await frames(page)).at(-1)).toEqual({ x: expect.closeTo(to, 0), quiet: null, leaving: 0 });
  const seen = await frames(page);
  // On the way: somewhere between, and the quiet one part-faded.
  expect(seen.some((frame) => frame.x !== null && frame.x > from + 1 && frame.x < to - 1)).toBe(true);
  expect(seen.some((frame) => frame.quiet !== null && frame.quiet > 0 && frame.quiet < 1)).toBe(true);
});

test("with reduced motion, a moved storm and a gone one change at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await serveAMove(page);
  const { from, to } = await openThenAskAgain(page);
  await expect.poll(() => strongX(page), { timeout: 15_000 }).toBeCloseTo(to, 0);
  const seen = await frames(page);
  expect(seen.filter((frame) => frame.x !== null && frame.x > from + 1 && frame.x < to - 1)).toEqual([]);
  expect(seen.filter((frame) => frame.leaving > 0 || (frame.quiet !== null && frame.quiet < 1))).toEqual([]);
  expect(seen.at(-1)?.quiet).toBeNull();
});
