import type { Page, Request } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, overlaps, settled, stationPicker, stationToggle, timeline } from "./app";

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

const toggle = stationToggle;
const picker = stationPicker;
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
  await expect(status(page)).toHaveAttribute("title", /^Measured \d\d:\d\d, .+ ago$/);
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

  // Opened again without a link, which would say its own parameter.
  const again = page.waitForRequest(asksFor);
  await page.goto(GERMANY_VIEW);
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

test("a forecast frame asks for nothing new and greys the newest stations, which no station has measured", async ({ page }) => {
  await openWithStations(page);
  const opacity = () => page.evaluate(() => (window as any).lm.getCurrentMap().getAllLayers()
    .find((layer: any) => layer.getZIndex() === 150).getOpacity());
  expect(await opacity()).toBe(1);
  let asked = false;
  page.on("request", (request) => { if (asksFor(request)) asked = true; });
  await timeline(page).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  // Still reachable: the stations do not keep the needle out of the forecast.
  await expect(timeline(page)).toHaveAttribute("aria-valuetext", /^\+/);
  await expect.poll(opacity).toBeLessThan(1);
  // Past the debounce.
  await page.waitForTimeout(1000);
  expect(asked).toBe(false);
  await expect(page.locator(".strip .no-sweep")).toHaveCount(0);

  await page.keyboard.press("Home");
  await expect.poll(opacity).toBe(1);
});

test("the stations are asked for with room for DWD's delay", async ({ page }) => {
  const request = await openWithStations(page);
  expect(Number(new URL(request.url()).searchParams.get("max_age_minutes"))).toBeGreaterThanOrEqual(90);
});

test("tapping a station opens its name, its state, height and when it measured, and its values", async ({ page }) => {
  await openWithStations(page);
  await expect.poll(() => someStation(page), { timeout: 10_000 }).not.toBeNull();
  const station = (await someStation(page))!;
  await page.mouse.click(station.x, station.y);
  const panel = page.getByRole("region", { name: station.name });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^[^·]+ · \d+ m · measured \d\d:\d\d$/)).toBeVisible();
  // Its newest values first, in the line of facts under the title.
  await expect(panel.locator(".stats").getByText("Wind direction", { exact: true })).toBeVisible();
  // The speed as measured, the knots a barb is drawn in under it.
  await expect(panel.getByText(/^\d+\.\d m\/s$/).first()).toBeVisible();
  await expect(panel.getByText(/^\d+ kt$/).first()).toBeVisible();
  await expect(panel.getByText("Data: Deutscher Wetterdienst (CC BY 4.0)")).toBeVisible();
});

test("a station's sheet charts what it measured, summed up, over the period chosen", async ({ page }) => {
  const asked: string[] = [];
  await page.route(/\/stations\/\d+\/observations/, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.searchParams.get("since")!);
    const since = Date.parse(url.searchParams.get("since")!);
    const observations = Array.from({ length: 144 }, (_, i) => ({
      observed_at: new Date(since + (i + 1) * 600_000).toISOString(),
      temperature_c: 10 + (i % 6),
      temperature_max_c: 10.5 + (i % 6),
      temperature_min_c: 9.5 + (i % 6),
      dew_point_c: 6,
      precipitation_mm: i % 12 === 0 ? 0.4 : 0,
      wind_speed_m_s: 2,
      gust_m_s: 5,
      wind_direction_deg: 220,
    }));
    return route.fulfill({ json: { station: { type: "Feature", id: "x", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }, observations } });
  });
  await openWithStations(page);
  await expect.poll(() => someStation(page), { timeout: 10_000 }).not.toBeNull();
  const station = (await someStation(page))!;
  await page.mouse.click(station.x, station.y);
  const panel = page.getByRole("region", { name: station.name });
  await expect(panel.getByRole("img", { name: /^Temperature and dew point over the period/ })).toBeAttached();
  // Each caption leads with the figure it is read for, in its unit, and
  // what sums the period up in that unit beside it.
  const resting = (name: string) => panel.locator("figcaption", { hasText: name }).locator(".state:not(.reading)");
  await expect(resting("Temperature and dew point").locator(".figure")).toHaveText(/^\d+\.\d°C$/);
  await expect(resting("Temperature and dew point").locator(".summary")).toContainText("max 15.5 · min 9.5");
  // An amount's figure is its total.
  await expect(resting("Precipitation").locator(".figure")).toHaveText(/^\d+\.\dmm$/);
  await expect(resting("Wind and gusts").locator(".summary")).toContainText("peak gust 5.0");
  // Measured only: no sunshine, humidity or pressure in this answer, so no panels for them.
  await expect(panel.locator("figcaption", { hasText: "Humidity" })).toHaveCount(0);

  // The plots run the sheet's width, drawn at it rather than scaled into it.
  const history = (await panel.locator(".history").boundingBox())!;
  const chart = (await panel.locator(".history svg").first().boundingBox())!;
  expect(chart.width).toBeGreaterThan(history.width - 1);
  expect(await panel.locator(".history svg").first().getAttribute("viewBox")).toBe(`0 0 ${Math.round(chart.width)} ${Math.round(chart.height)}`);

  // A finger dragged sideways along a panel puts a line on one moment, its
  // values in every caption, and leaves it there when let go.
  const reading = (name: string) => panel.locator("figcaption", { hasText: name }).locator(".state.reading");
  await panel.locator(".history").evaluate((history, box) => {
    const fire = (type: string, x: number) => history.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: box.y + box.height / 2,
    }));
    fire("pointerdown", box.x + box.width * 0.3);
    for (let share = 0.32; share <= 0.5; share += 0.03) fire("pointermove", box.x + box.width * share);
    fire("pointerup", box.x + box.width * 0.5);
  }, chart);
  await expect(reading("Temperature and dew point").locator(".figure")).toHaveText(/^\d+\.\d°C$/);
  await expect(reading("Temperature and dew point").locator(".summary")).toHaveText(/^\d\d:\d\d · dew point 6\.0 °C$/);
  await expect(panel.locator(".history .cursor")).not.toHaveCount(0);
  await expect(reading("Wind and gusts").locator(".figure")).toHaveText("2.0m/s");
  await expect(reading("Wind and gusts").locator(".summary")).toHaveText(/^\d\d:\d\d · gust 5\.0 m\/s$/);

  // Six days further back for a week than for a day.
  await panel.getByRole("radio", { name: "7 days" }).click();
  await expect.poll(() => asked.length).toBe(2);
  const further = (Date.parse(asked[0]) - Date.parse(asked[1])) / 3_600_000;
  expect(further).toBeGreaterThan(143.9);
  expect(further).toBeLessThan(144.1);
});

test("with the stations on, the map credits DWD", async ({ page }) => {
  await openWithStations(page);
  await expect(page.locator(".ol-attribution")).toContainText("DWD");
});

/** The bounding boxes of what is stacked over the player, bottom first. */
const below = (a: { y: number; height: number }, b: { y: number }) => a.y + a.height <= b.y;

test("the picker floats over the player, which does not grow, and what stacks over the player stands on it", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  const player = page.locator(".timeslider");
  await settled(player);
  const before = (await player.boundingBox())!.height;
  await toggle(page).click();
  const pill = page.locator(".stationPicker");
  await settled(pill);
  expect((await player.boundingBox())!.height).toBe(before);
  const [box, tray] = [(await pill.boundingBox())!, (await player.boundingBox())!];
  expect(below(box, tray)).toBe(true);
  expect(tray.y - (box.y + box.height)).toBeLessThan(16);

  // "Back to now" over it, not on it.
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  const back = page.getByRole("button", { name: "Back to now" });
  await settled(back);
  expect(below((await back.boundingBox())!, (await pill.boundingBox())!)).toBe(true);

  // Off, the picker goes and Back to now comes down to the player.
  await toggle(page).click();
  await expect(pill).toHaveCount(0);
  await settled(back);
  const lowered = (await back.boundingBox())!;
  expect((await player.boundingBox())!.y - (lowered.y + lowered.height)).toBeLessThan(16);
});

test("the picker stands on a notice strip over the player", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("layerStations", "true"));
  await openRadar(page, "/?layer=radar&latLonZ=44.43000,26.10000,10.00");
  const pill = page.locator(".stationPicker");
  await settled(pill);
  const strip = page.locator(".strip-dock");
  await expect(page.getByText("No Radar Here Yet")).toBeVisible();
  await settled(strip);
  // The strip is about the map, the picker about how it is read: the strip next to the player.
  expect(below((await pill.boundingBox())!, (await strip.boundingBox())!)).toBe(true);
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the room a phone's player has");

  test("the picker fits the screen, scrolls sideways where it must, and keeps clear of the player and the credits", async ({ page }) => {
    await openWithStations(page);
    const pill = page.locator(".stationPicker");
    await settled(pill);
    const box = (await pill.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(below(box, (await page.locator(".timeslider").boundingBox())!)).toBe(true);
    const credits = page.locator(".ol-attribution");
    if (await credits.isVisible()) expect(overlaps((await credits.boundingBox())!, box)).toBe(false);
    // Where every parameter does not fit, the row scrolls and says so.
    const scroller = pill.locator(".scroller");
    if (await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)) {
      await expect(scroller).toHaveClass(/fade-end/);
    }
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
