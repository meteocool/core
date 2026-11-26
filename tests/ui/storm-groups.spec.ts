import type { Page } from "@playwright/test";
import { backToNow, flatPixel, noGeocoder, settled, statusPill, timeline } from "./app";
import { recordedStorms } from "./storms";
import { expect, test } from "./test";

/**
 * The storms that matter, and the systems they make up: a notable storm is
 * marked as every storm was, the rest are quiet dots that still open, and
 * storms that are one system share one outline under their marks. A backend
 * from before any of this still draws every storm as it did, with no
 * outline and nothing said about it.
 *
 * Over the Gulf of Lion, where the recording's storms are; the recorded
 * active ones were given `notable`, `rating` and `group` by hand, and
 * `/storms/groups` outlines four systems of them (tests/ui/README.md).
 */

const stormBy = (suffix: string) => recordedStorms().map(({ storm }) => storm).find((storm) => storm.id.endsWith(suffix))!;

/** Two marked storms and a quiet one of the Camargue's system, and a quiet one of the Var's. */
const STRONG = stormBy("AJYXQB");
const MODERATE = stormBy("24TMKT");
const QUIET = stormBy("60RP0J");
const QUIET_VAR = stormBy("9Z88XH");
const CAMARGUE = "01M6MG0000CAMARGUE0000000B";

/** What the flat map draws: each storm's position by id, quiet or not, and the groups outlined. */
const drawn = (page: Page) => page.evaluate(() => {
  const layers = (window as any).lm.maps[0].getLayers().getArray();
  const cells = layers.find((layer: any) => layer.getZIndex() === 202);
  const groups = layers.find((layer: any) => layer.getZIndex() === 88);
  const positions = cells.getSource().getFeatures().filter((feature: any) => feature.get("kind") === "position");
  return {
    quiet: positions.filter((feature: any) => feature.get("quiet")).map((feature: any) => feature.getId() as string),
    full: positions.filter((feature: any) => !feature.get("quiet")).map((feature: any) => feature.getId() as string),
    groups: (groups?.getSource().getFeatures() ?? []).map((feature: any) => feature.getId() as string),
    stale: (groups?.getSource().getFeatures() ?? [])
      .filter((feature: any) => feature.get("stale") && !feature.get("leaving")).map((feature: any) => feature.getId() as string),
    groupsShown: Boolean(groups?.getVisible()),
  };
});

/** How many live rings are centred on a storm. */
async function ringsOn(page: Page, storm: { geometry: { coordinates: number[] } }): Promise<number> {
  const [lon, lat] = storm.geometry.coordinates;
  const at = await flatPixel(page, lon, lat);
  const centres = await page.locator(".mc-cell-pulse svg").evaluateAll((svgs) => svgs.map((svg) => {
    const box = svg.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }));
  return centres.filter((c) => Math.hypot(c.x - at.x, c.y - at.y) < 6).length;
}

async function openAt(page: Page, [lon, lat]: number[], zoom: number): Promise<void> {
  await page.goto(`/?layer=radar&latLonZ=${lat.toFixed(5)},${lon.toFixed(5)},${zoom.toFixed(2)}`);
  await settled(timeline(page));
  await expect.poll(async () => (await drawn(page)).full.length + (await drawn(page)).quiet.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test("notable storms are marked, the rest are quiet dots, and a system is one outline", async ({ page }) => {
  await openAt(page, STRONG.geometry.coordinates, 10);
  await expect.poll(async () => (await drawn(page)).groups, { timeout: 15_000 }).toContain(CAMARGUE);
  const marks = await drawn(page);
  expect(marks.full).toEqual(expect.arrayContaining([STRONG.id, MODERATE.id]));
  expect(marks.quiet).toContain(QUIET.id);
  expect(marks.full).not.toContain(QUIET.id);
  expect(marks.groupsShown).toBe(true);
  // A quiet storm has no ring of its own; a live notable one has.
  await expect.poll(() => ringsOn(page, STRONG)).toBe(1);
  expect(await ringsOn(page, QUIET)).toBe(0);
});

test("a system's outline is dashed a scan behind the radar and solid on its own scan", async ({ page }) => {
  await openAt(page, STRONG.geometry.coordinates, 10);
  await expect.poll(async () => (await drawn(page)).groups, { timeout: 15_000 }).toContain(CAMARGUE);
  // The recording's systems are a scan behind its newest radar frame.
  expect((await drawn(page)).stale).toContain(CAMARGUE);
  // A step back is the systems' own scan.
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await drawn(page)).stale).not.toContain(CAMARGUE);
  expect((await drawn(page)).groups).toContain(CAMARGUE);
  await backToNow(page).click();
  await expect.poll(async () => (await drawn(page)).stale).toContain(CAMARGUE);
});

test("the storm key explains a system's outline, solid and dashed, and switches it off and on", async ({ page }) => {
  await noGeocoder(page);
  await openAt(page, STRONG.geometry.coordinates, 10);
  await expect.poll(async () => (await drawn(page)).groups, { timeout: 15_000 }).toContain(CAMARGUE);
  await page.getByRole("button", { name: "Storms" }).click();
  await expect(page.getByText("Storm system", { exact: true })).toBeVisible();
  await expect(page.getByText(/Dashed: the outline is from another scan/)).toBeVisible();
  const outlines = page.getByRole("switch", { name: "Show on the map: Storm system" });
  await expect(outlines).toBeChecked();
  // Off: the outlines go (fading out), the storms stay, and a shared link says so.
  await outlines.uncheck();
  const shown = async () => {
    const features = await page.evaluate(() => {
      const groups = (window as any).lm.maps[0].getLayers().getArray().find((layer: any) => layer.getZIndex() === 88);
      return groups.getSource().getFeatures().filter((feature: any) => !feature.get("leaving")).map((feature: any) => feature.getId() as string);
    });
    return features;
  };
  await expect.poll(shown).not.toContain(CAMARGUE);
  expect((await drawn(page)).full).toContain(STRONG.id);
  await expect.poll(() => new URL(page.url()).searchParams.get("hide")).toBe("system");
  // On again.
  await outlines.check();
  await expect.poll(shown).toContain(CAMARGUE);
});

test("a quiet storm opens when tapped, is drawn in full while open, and its panel names its system", async ({ page, isMobile }) => {
  await noGeocoder(page);
  await openAt(page, QUIET_VAR.geometry.coordinates, 10);
  await expect.poll(async () => (await drawn(page)).quiet, { timeout: 15_000 }).toContain(QUIET_VAR.id);
  const [lon, lat] = QUIET_VAR.geometry.coordinates;
  const at = await flatPixel(page, lon, lat);
  await page.mouse.click(at.x, at.y);
  if (isMobile) {
    const details = page.getByRole("button", { name: /^Details/ });
    await expect(details).toBeVisible();
    await details.click();
  }
  const opened = page.getByRole("region", { name: /storm$/i });
  await expect(opened).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`storm=${QUIET_VAR.id}`));
  await expect(opened.getByText("system", { exact: true })).toBeVisible();
  await expect(opened.getByText("6 storms", { exact: true })).toBeVisible();
  // Its rating is the backend's business: no raw number in the panel.
  await expect(opened).not.toContainText("rating");
  await expect.poll(async () => (await drawn(page)).full).toContain(QUIET_VAR.id);
});

test("a storm in no system has no system in its panel", async ({ page, isMobile }) => {
  const alone = stormBy("QTBGRV");
  await noGeocoder(page);
  await openAt(page, alone.geometry.coordinates, 10);
  const [lon, lat] = alone.geometry.coordinates;
  const at = await flatPixel(page, lon, lat);
  await page.mouse.click(at.x, at.y);
  if (isMobile) {
    const details = page.getByRole("button", { name: /^Details/ });
    await expect(details).toBeVisible();
    await details.click();
  }
  const opened = page.getByRole("region", { name: /storm$/i });
  await expect(opened).toBeVisible();
  await expect(opened.getByText("peak", { exact: true })).toBeVisible();
  await expect(opened.getByText("system", { exact: true })).toHaveCount(0);
});

for (const status of [404, 422]) {
  test(`an older backend, with no notability and a ${status} for groups, draws every storm as before and says nothing`, async ({ page }) => {
    // The recorded storms as a backend from before rating sends them.
    const older = recordedStorms().map(({ storm }) => {
      const properties = { ...storm.properties };
      for (const field of ["notable", "rating", "group"]) delete properties[field];
      return { ...storm, properties };
    });
    const asked: string[] = [];
    await page.route(/\/storms(\/|\?|$)/, (route) => {
      const url = new URL(route.request().url());
      asked.push(url.pathname);
      if (url.pathname === "/storms/groups") return route.fulfill({ status, json: { detail: "Not Found" } });
      if (url.pathname !== "/storms") return route.fulfill({ status: 404, json: { detail: "unknown storm" } });
      return route.fulfill({ json: { type: "FeatureCollection", features: older } });
    });
    await openAt(page, STRONG.geometry.coordinates, 10);
    const marks = await drawn(page);
    expect(marks.quiet).toEqual([]);
    expect(marks.full).toEqual(expect.arrayContaining([STRONG.id, QUIET.id]));
    expect(marks.groups).toEqual([]);
    await expect.poll(() => ringsOn(page, QUIET)).toBe(1);
    // Nothing said about it: the feed reads as it would.
    await expect(statusPill(page)).toHaveText("Latest");
    expect(asked.filter((path) => path === "/storms/groups")).toHaveLength(1);

    // Moved off what was fetched: the storms are asked for again, the groups not.
    const storms = asked.filter((path) => path === "/storms").length;
    await page.evaluate(() => {
      const view = (window as any).lm.maps[0].getView();
      const [x, y] = view.getCenter();
      view.setCenter([x + 200_000, y]);
    });
    await expect.poll(() => asked.filter((path) => path === "/storms").length).toBeGreaterThan(storms);
    expect(asked.filter((path) => path === "/storms/groups")).toHaveLength(1);
  });
}
