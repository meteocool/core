import type { Page, Request } from "@playwright/test";
import { expect, test } from "./test";
import { noGeocoder, openRadar, radarMark, settled, stationPicker, stationToggle } from "./app";

/**
 * What a link to the map carries of what it shows: the address bar, which
 * the page keeps up to date, and the share link made from it. Overlays and
 * what they show are the sender's; the receiver's saved settings are left as
 * they were. See lib/deepLink.ts.
 *
 * Central Germany at a zoom where Offenthal's mark is in view on a phone, and
 * the stations around it are in the hand-written fixture.
 */
const VIEW = "/?layer=radar&latLonZ=50.20000,9.20000,7.20";

/** Kahl/Main, one of the stations in the fixture, with a temperature. */
const STATION = { id: "02480", name: "Kahl/Main" };

const asksForStations = (request: Request) => new URL(request.url()).pathname === "/stations/observations";
const parameters = (request: Request) => new URL(request.url()).searchParams.getAll("parameter");
const param = (url: string, name: string) => new URL(url).searchParams.get(name);
const overlaysIn = (url: string) => (param(url, "overlays") ?? "").split(",");

/** What the next share sends, caught in place of the platform's share sheet. */
async function catchShares(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => { (window as any).shared = data; },
    });
  });
}

/** Press the map's share button, and return the URL it sent. */
async function shareFromMap(page: Page): Promise<string> {
  await page.locator(".ol-share button").click();
  await expect.poll(() => page.evaluate(() => (window as any).shared?.url ?? null)).not.toBeNull();
  return page.evaluate(() => (window as any).shared.url as string);
}

/** Whether the radars' marks are drawn: Offenthal's is in view. */
const marksShown = async (page: Page) => (await radarMark(page, "deoft")) !== null;

test("the stations with Temp and the radars' marks go into the address bar, and into a share link", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("layerSites", "false"));
  await catchShares(page);
  await noGeocoder(page);
  await openRadar(page, VIEW);
  await expect.poll(() => overlaysIn(page.url())).toContain("-sites");
  await expect.poll(() => overlaysIn(page.url())).toContain("-stations");

  await stationToggle(page).click();
  await settled(stationPicker(page));
  await stationPicker(page).getByRole("radio", { name: "Temp" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Radar Sites" }).check();
  await page.keyboard.press("Escape");
  await expect.poll(() => marksShown(page), { timeout: 20_000 }).toBe(true);

  await expect.poll(() => overlaysIn(page.url())).toEqual(["cells", "lightning", "mesocyclones", "sites", "stations"]);
  await expect.poll(() => param(page.url(), "stationParameter")).toBe("temperature");

  const shared = await shareFromMap(page);
  expect(overlaysIn(shared)).toEqual(["cells", "lightning", "mesocyclones", "sites", "stations"]);
  expect(param(shared, "stationParameter")).toBe("temperature");
  expect(param(shared, "shared")).toMatch(/^\d{8}T\d{4}Z$/);
});

test("such a link opened somewhere nothing is saved shows the stations with Temp and the radars' marks", async ({ page, freshPage }) => {
  await page.addInitScript(() => localStorage.setItem("layerSites", "false"));
  await catchShares(page);
  await noGeocoder(page);
  await openRadar(page, VIEW);
  await stationToggle(page).click();
  await settled(stationPicker(page));
  await stationPicker(page).getByRole("radio", { name: "Temp" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Radar Sites" }).check();
  await page.keyboard.press("Escape");
  await expect.poll(() => param(page.url(), "stationParameter")).toBe("temperature");
  const link = new URL(await shareFromMap(page));

  const receiver = await freshPage();
  await noGeocoder(receiver);
  const asked = receiver.waitForRequest(asksForStations);
  await openRadar(receiver, `${link.pathname}${link.search}`);
  expect(parameters(await asked)).toEqual(["temperature_c"]);
  await expect(stationToggle(receiver)).toHaveAttribute("aria-pressed", "true");
  await settled(stationPicker(receiver));
  await expect(stationPicker(receiver).getByRole("radio", { name: "Temp" })).toBeChecked();
  await expect.poll(() => marksShown(receiver), { timeout: 20_000 }).toBe(true);
  // Shown, not stored: the receiver's own settings are as they were.
  expect(await receiver.evaluate(() => [localStorage.getItem("layerStations"), localStorage.getItem("stationParameter")]))
    .toEqual([null, null]);
});

test("a link from a sender with the stations off shows them off to a receiver who keeps them on", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("layerStations", "true");
    localStorage.setItem("stationParameter", "pressure");
  });
  let asked = false;
  page.on("request", (request) => { if (asksForStations(request)) asked = true; });
  await openRadar(page, `${VIEW}&overlays=cells,lightning,mesocyclones,sites,-stations`);
  await expect(stationToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(stationPicker(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(asked).toBe(false);
  // And theirs is still on, for the next time they open the site without the link.
  expect(await page.evaluate(() => localStorage.getItem("layerStations"))).toBe("true");
  await page.goto(VIEW);
  await expect(stationToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(stationPicker(page).getByRole("radio", { name: "Pressure" })).toBeChecked();
});

test("a link from before leaves the stations and the radars' marks to the receiver, and its overlays as they were", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("layerStations", "true");
    localStorage.setItem("stationParameter", "humidity");
    localStorage.setItem("layerSites", "false");
  });
  await noGeocoder(page);
  const asked = page.waitForRequest(asksForStations);
  await openRadar(page, `${VIEW}&overlays=cells,lightning`);
  expect(parameters(await asked)).toEqual(["humidity_pct"]);
  await expect(stationToggle(page)).toHaveAttribute("aria-pressed", "true");
  // The cyclones, which it did not name, off as ever; the marks the receiver's own, off.
  await expect.poll(() => overlaysIn(page.url()))
    .toEqual(["cells", "lightning", "-mesocyclones", "-sites", "stations"]);
  expect(await marksShown(page)).toBe(false);
});

test("a link to a station opens its sheet, with the stations on and its parameter", async ({ page }) => {
  await noGeocoder(page);
  const asked = page.waitForRequest(asksForStations);
  // Not openRadar: on a phone the sheet puts the player away.
  await page.goto(`${VIEW}&station=${STATION.id}&stationParameter=temperature`);
  expect(parameters(await asked)).toEqual(["temperature_c"]);
  const sheet = page.getByRole("region", { name: STATION.name });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("Temperature", { exact: true })).toBeVisible();
  // Written back as the page now says it, the stations on with it.
  await expect.poll(() => overlaysIn(page.url())).toContain("stations");
  expect(param(page.url(), "station")).toBe(STATION.id);
  expect(param(page.url(), "stationParameter")).toBe("temperature");
});

test("the radar product is the sender's, and the receiver's own stays saved", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("radarProduct", "merged"));
  await openRadar(page, `${VIEW}&product=hx`);
  await expect.poll(() => param(page.url(), "product")).toBe("hx");
  expect(await page.evaluate(() => localStorage.getItem("radarProduct"))).toBe("merged");
});
