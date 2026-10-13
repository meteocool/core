import type { Page } from "@playwright/test";
import { flatPixel, settled, timeline } from "./app";
import { readRecording } from "./offline";
import { expect, test } from "./test";

/**
 * The live rings, zoomed out: a storm just found on an established one's ring
 * gives way to it, ring and mark, while severe storms keep theirs however
 * close; from zoom 10 in every live storm is ringed.
 *
 * Over Aquitaine, where no recorded storm is, so the rings counted are these.
 */

const LAT = 44.8;
const LON = -0.6;
const SEVERE_LON = LON + 1;

const recordedAt = readRecording().recordedAt;
const minutesAgo = (minutes: number) => new Date(recordedAt - minutes * 60_000).toISOString();

/** A storm still being seen, tracked for `history` minutes, with no path to speak of. */
function storm(id: string, lon: number, severity: number, history: number) {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [lon, LAT] },
    properties: {
      id,
      born_at: minutesAgo(2 + history),
      last_seen: minutesAgo(2),
      status: "active",
      merged_into: null,
      primary_track: `meteocool/tracker/fr/stand-in/core/${id}`,
      primary_product: "meteocool/tracker",
      primary_domain: "fr",
      severity,
      hail: false,
      meso: false,
      bbox: { west: lon, south: LAT, east: lon, north: LAT },
      path: { type: "Point", coordinates: [lon, LAT] },
      tracks: [],
    },
  };
}

const STORMS = [
  // A green storm with an hour behind it, and one found a scan ago 2 km east.
  storm("01KRINGSOLD000000000000000", LON, 0, 60),
  storm("01KRINGSNEW000000000000000", LON + 0.03, 0, 0),
  // Two severe ones on each other, a hundred kilometres east of those.
  storm("01KRINGSRED000000000000000", SEVERE_LON, 2, 5),
  storm("01KRINGSPURPLE000000000000", SEVERE_LON + 0.03, 3, 0),
];

/** How many rings are centred within a ring's width of [lon, LAT]. */
async function ringsAt(page: Page, lon: number): Promise<number> {
  const at = await flatPixel(page, lon, LAT);
  const centres = await page.locator(".mc-cell-pulse svg").evaluateAll((svgs) => svgs.map((svg) => {
    const box = svg.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }));
  return centres.filter((c) => Math.hypot(c.x - at.x, c.y - at.y) < 26).length;
}

async function openAt(page: Page, zoom: number, lon: number): Promise<void> {
  await page.route(/\/storms(\/|\?|$)/, (route) => route.fulfill({ json: { type: "FeatureCollection", features: STORMS } }));
  await page.goto(`/?layer=radar&latLonZ=${LAT.toFixed(5)},${lon.toFixed(5)},${zoom.toFixed(2)}`);
  await settled(timeline(page));
  await expect.poll(() => page.locator(".mc-cell-pulse svg").count(), { timeout: 15_000 }).toBeGreaterThan(0);
}

test("zoomed out, a new storm on an established one's ring gives way, and severe ones stay", async ({ page }) => {
  await openAt(page, 6, (LON + SEVERE_LON) / 2);
  await expect.poll(() => ringsAt(page, LON)).toBe(1);
  await expect.poll(() => ringsAt(page, SEVERE_LON)).toBe(2);
  // The established one is the one kept: the new one's ring is not drawn east of it.
  const kept = await flatPixel(page, LON, LAT);
  const centre = await page.locator(".mc-cell-pulse svg").evaluateAll((svgs, { x, y }) => svgs.some((svg) => {
    const box = svg.getBoundingClientRect();
    return Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y) < 1;
  }), kept);
  expect(centre).toBe(true);
});

test("from zoom 10 in, every live storm is ringed", async ({ page }) => {
  await openAt(page, 10, LON);
  await expect.poll(() => ringsAt(page, LON)).toBe(2);
});
