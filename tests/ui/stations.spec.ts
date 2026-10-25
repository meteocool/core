import type { Page, Request } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, overlaps, playButton, settled, timeline } from "./app";

/**
 * DWD's weather stations over the radar map: switched by a pill in the
 * player, one parameter at a time, the wind as barbs, following the timeline.
 *
 * `/stations/observations` is answered from a fixture written by hand
 * (fixtures/api/GET_stations_observations.json) from a real answer, its times
 * moved onto the recording's clock: staging did not serve the route when
 * this was written. One answer for every parameter, so it holds them all.
 */
const GERMANY_VIEW = "/?layer=radar&latLonZ=50.50000,10.00000,8.00";

const toggle = (page: Page) => page.getByRole("button", { name: "Stations", exact: true });
const picker = (page: Page) => page.getByRole("radiogroup", { name: "Station parameter" });
const status = (page: Page) => page.locator(".stationPicker .status");
const asksFor = (request: Request) => new URL(request.url()).pathname === "/stations/observations";
const parameters = (request: Request) => new URL(request.url()).searchParams.getAll("parameter");
const askedAt = (request: Request) => new URL(request.url()).searchParams.get("at");

/** The radar map with the stations on, as a reader who turned them on before; resolves with the first request. */
async function openWithStations(page: Page): Promise<Request> {
  await page.addInitScript(() => localStorage.setItem("layerStations", "true"));
  const first = page.waitForRequest(asksFor);
  await openRadar(page, GERMANY_VIEW);
  const request = await first;
  await settled(picker(page));
  await expect(status(page)).toHaveAttribute("title", /^Measured \d\d:\d\d$/);
  return request;
}

/** A link's frame, `20261011T0115Z`, as an `at` is written. */
const asFrame = (at: string) => new Date(at).toISOString().replace(/[-:]/g, "").replace(/\d\d\.\d{3}Z$/, "Z");

/**
 * The page pixel of the drawn station nearest the middle of the map, with
 * its name: one the chrome does not cover. Null before the map has drawn.
 */
const someStation = (page: Page) => page.evaluate(() => {
  const map = (window as any).lm.getCurrentMap();
  const layer = map?.getAllLayers().find((candidate: any) => candidate.getSource?.()?.getFeatures?.()
    ?.some((feature: any) => feature.get("observed")));
  if (!layer?.getVisible()) return null;
  const rect = map.getViewport().getBoundingClientRect();
  const middle = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const drawn = layer.getSource().getFeatures()
    .filter((feature: any) => !feature.get("thinned") && typeof feature.get("observed").wind_direction_deg === "number")
    .map((feature: any) => {
      const pixel = map.getPixelFromCoordinate(feature.getGeometry().getCoordinates());
      return pixel && { x: rect.left + pixel[0], y: rect.top + pixel[1], name: feature.get("observed").name as string };
    })
    .filter((at: { x: number; y: number } | null) => {
      if (!at) return false;
      const top = document.elementFromPoint(at.x, at.y);
      return top && map.getViewport().contains(top);
    })
    .sort((a: any, b: any) => Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y));
  return drawn[0] ?? null;
});

test("the stations are off by default, and the player's pill turns them on and off with their picker", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(picker(page)).toHaveCount(0);

  const asked = page.waitForRequest(asksFor);
  await toggle(page).click();
  expect(parameters(await asked)).toEqual(["wind_speed_m_s", "wind_direction_deg"]);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await settled(picker(page));
  await expect(picker(page).getByRole("radio", { name: "Wind" })).toBeChecked();
  await expect.poll(() => someStation(page), { timeout: 10_000 }).not.toBeNull();

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(picker(page)).toHaveCount(0);
  expect(await someStation(page)).toBeNull();
});

test("the stations stay on once turned on", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await toggle(page).click();
  await settled(picker(page));
  await page.reload();
  await settled(timeline(page));
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(picker(page)).toBeVisible();
});

test("choosing a parameter asks for that parameter alone, and the choice is remembered", async ({ page }) => {
  await openWithStations(page);
  const asked = page.waitForRequest(asksFor);
  await picker(page).getByRole("radio", { name: "Temp" }).click();
  expect(parameters(await asked)).toEqual(["temperature_c"]);

  const again = page.waitForRequest(asksFor);
  await page.reload();
  expect(parameters(await again)).toEqual(["temperature_c"]);
  await expect(picker(page).getByRole("radio", { name: "Temp" })).toBeChecked();
});

test("a past frame asks for the stations at its time, and back to now for the newest", async ({ page }) => {
  expect(askedAt(await openWithStations(page))).toBeNull();

  const past = page.waitForRequest(asksFor);
  await timeline(page).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowLeft");
  const at = askedAt(await past);
  expect(at).not.toBeNull();
  // The frame on screen, as the address bar names it.
  await expect.poll(() => new URL(page.url()).searchParams.get("t")).toBe(asFrame(at!));

  const live = page.waitForRequest(asksFor);
  await page.getByRole("button", { name: "Back to now" }).click();
  expect(askedAt(await live)).toBeNull();
});

test("a forecast frame asks for nothing new: the newest stations are already shown", async ({ page }) => {
  await openWithStations(page);
  let asked = false;
  page.on("request", (request) => { if (asksFor(request)) asked = true; });
  await timeline(page).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  // Past the debounce.
  await page.waitForTimeout(1000);
  expect(asked).toBe(false);
});

test("tapping a station opens its name, height and values, and when they were measured", async ({ page }) => {
  await openWithStations(page);
  await expect.poll(() => someStation(page), { timeout: 10_000 }).not.toBeNull();
  const station = (await someStation(page))!;
  await page.mouse.click(station.x, station.y);
  const panel = page.getByRole("region", { name: station.name });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Height", { exact: true })).toBeVisible();
  await expect(panel.getByText("Wind direction", { exact: true })).toBeVisible();
  await expect(panel.getByText(/ m\/s · \d+ kt$/).first()).toBeVisible();
  await expect(panel.getByText("Data: Deutscher Wetterdienst (CC BY 4.0)")).toBeVisible();
});

test("with the stations on, the map credits DWD", async ({ page }) => {
  await openWithStations(page);
  await expect(page.locator(".ol-attribution")).toContainText("DWD");
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the room a phone's player has");

  test("the pill and the picker sit inside the player, clear of the timeline, the play button and the credits", async ({ page }) => {
    await openWithStations(page);
    const player = page.locator(".timeslider");
    await settled(player);
    const box = (await player.boundingBox())!;
    const strip = (await timeline(page).boundingBox())!;
    const play = (await playButton(page).boundingBox())!;
    const credits = page.locator(".ol-attribution");
    for (const control of [toggle(page), picker(page)]) {
      const at = (await control.boundingBox())!;
      expect(at.x).toBeGreaterThanOrEqual(box.x);
      expect(at.y).toBeGreaterThanOrEqual(box.y);
      expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width);
      expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height);
      expect(overlaps(at, strip)).toBe(false);
      expect(overlaps(at, play)).toBe(false);
      if (await credits.isVisible()) expect(overlaps((await credits.boundingBox())!, at)).toBe(false);
    }
    // The player grows by the picker's row rather than pushing its own
    // bottom row out of it.
    expect(await player.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    expect(play.y + play.height).toBeLessThanOrEqual(box.y + box.height);
    for (const choice of await picker(page).getByRole("radio").all()) {
      // Not cut short with an ellipsis.
      expect(await choice.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
    }
  });
});

for (const [what, answer] of [
  ["a backend without stations (404)", { status: 404, json: { detail: "Not Found" } }],
  ["an empty answer", { status: 200, json: { type: "FeatureCollection", at: "2026-10-11T01:40:00Z", since: "2026-10-11T00:40:00Z", features: [] } }],
] as const) {
  test(`${what} leaves the stations on and empty, with no error`, async ({ page }) => {
    await page.route("**/stations/observations**", (route) => route.fulfill(answer));
    await page.addInitScript(() => localStorage.setItem("layerStations", "true"));
    await openRadar(page, GERMANY_VIEW);
    await settled(picker(page));
    await expect(status(page)).toHaveAttribute("title", "No observations");
    await page.waitForTimeout(500);
    await expect(page.locator("sl-alert[open]")).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  });
}
