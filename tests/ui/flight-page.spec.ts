import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { curtainUp, emptyAircraft, noGeocoder } from "./app";

/**
 * The flight's own page: meteoair.html, and the web app opened at
 * `#meteoair`. The radar map with nothing of the app's over it, the page's
 * words, and the way into the flight's plan and back: on a phone as on a
 * desktop, where the flight is flown by touch.
 */
const VIEW = "latLonZ=50.50000,9.50000,6.00";

const landing = (page: Page) => page.locator(".landing");
const board = (page: Page) => page.getByRole("button", { name: "Plan a flight" });
const appChrome = (page: Page) =>
  page.locator(".top-left, .bottomToolbar, .lsToggle, .live-wrapper, .ol-zoom, .ol-geolocate, .ol-share").filter({ visible: true });

for (const path of [`/meteoair.html?${VIEW}`, `/?${VIEW}#meteoair`]) {
  test(`${path.split("?")[0]}${path.includes("#") ? "#meteoair" : ""} is the flight's page, over a map without the app's chrome`,
    async ({ page }) => {
      await page.goto(path);
      await expect(landing(page)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Fly through live clouds");
      await expect(page.locator("#map canvas").first()).toBeVisible();
      await expect(appChrome(page)).toHaveCount(0);
      await expect(page.locator(".ol-attribution")).toContainText("OpenStreetMap");
      // The address stays the page's own: nothing of the map is written into it.
      expect(new URL(page.url()).search).toBe(`?${VIEW}`);
      // The flight is offered on a phone too.
      await expect(board(page)).toBeVisible();
    });
}

test("the button opens the flight's plan, and the plan put away is meteocool's radar map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
  // The 3D map's first bring-up and Studio's chunk, both under this one test.
  test.setTimeout(240_000);
  await noGeocoder(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await board(page).click();
  const plan = page.getByRole("region", { name: "Flight plan" });
  await expect(plan).toBeVisible({ timeout: 120_000 });
  await expect(landing(page)).toHaveCount(0);
  // Studio's own tools are not this page's.
  await expect(page.getByRole("button", { name: "Take off" })).toBeVisible();
  // Escape, the ✕, Back to meteocool: off the flight's page altogether, to the map's rain and thunderstorms.
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.pathname.endsWith("meteoair.html"), { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as any).lm?.currentCap), { timeout: 30_000 }).toBe("radar");
  await expect(landing(page)).toHaveCount(0);
});

test("a flight's link takes off at once from where it says, and once it is over the page is its own again", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
  test.setTimeout(240_000);
  await noGeocoder(page);
  // An empty aircraft: a software renderer draws the real one a frame every few seconds.
  await emptyAircraft(page);
  await page.goto(`/meteoair.html?${VIEW}&fly=50.4000,9.6000&hdg=090&alt=FL120&spd=280kt&view=outside`);
  const deck = page.getByRole("region", { name: "Flight deck" });
  // The storms waited for, with a word meanwhile; then in the air.
  await expect(page.getByRole("status").filter({ hasText: "Finding the storms" })).toBeVisible({ timeout: 120_000 });
  await expect(deck).toBeVisible({ timeout: 30_000 });
  // Neither the page's words nor the plan on the way.
  await expect(landing(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Flight plan" })).toHaveCount(0);
  await expect(deck).toHaveClass(/view-outside/);
  const plan = await page.evaluate(() => {
    const { flightPlan } = (window as any).flightPilot;
    return { lat: flightPlan.lat, lon: flightPlan.lon, heading: flightPlan.heading, feet: flightPlan.altitude * 3.28084, aimed: flightPlan.aimed };
  });
  expect(plan.lat).toBeCloseTo(50.4, 6);
  expect(plan.lon).toBeCloseTo(9.6, 6);
  expect(plan.heading).toBe(90);
  expect(plan.aimed).toBe(false);
  expect(Math.round(plan.feet)).toBe(12_000);
  // The link stays while it flies: a reload is the same flight.
  expect(new URL(page.url()).searchParams.get("fly")).toBe("50.4000,9.6000");
  // Over, it comes down on the page's plan, and the address is the page's own again; asked once take-off's black has lifted.
  await curtainUp(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "End the flight?" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Flight plan" })).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).search).toBe(`?${VIEW}`);
  // And the plan on screen has a link of its own to give.
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
});

test("a moment shared with a storm cut open opens on that storm cut open, the cut where it stood", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
  // Two flights, each with the 3D map's first bring-up.
  test.setTimeout(420_000);
  await noGeocoder(page);
  await emptyAircraft(page);
  const deck = page.getByRole("region", { name: "Flight deck" });
  const inspecting = deck.getByRole("group", { name: "Look into the storm" });
  const depth = inspecting.getByRole("group", { name: "Where the cut stands" }).locator("output");
  const looked = () => page.evaluate(() => {
    const pilot = (window as any).flightPilot;
    return pilot.inspected && { lon: pilot.inspected.mark.lon, lat: pilot.inspected.mark.lat, mode: pilot.inspected.mode, cut: pilot.cutSetting };
  });

  // West towards the recorded storms over the Gulf of Lion.
  await page.goto("/meteoair.html?latLonZ=43.30000,4.40000,7.00&fly=43.3000,4.7000&hdg=265&alt=FL120&spd=280kt&view=outside");
  await expect(deck).toBeVisible({ timeout: 150_000 });
  await curtainUp(page);
  // A storm marked in the view, looked into (I), cut open (I again), turned and pushed deeper.
  await expect.poll(() => page.evaluate(() => (window as any).flightPilot.telemetry.marks.length), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.keyboard.press("KeyI");
  await expect(inspecting.getByRole("radio", { name: "X-ray" })).toBeChecked();
  await page.keyboard.press("KeyI");
  await expect(inspecting.getByRole("radio", { name: "Cut open" })).toBeChecked();
  await page.keyboard.press("Period");
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("BracketRight");
  await expect(depth).toHaveText("+3.0 km");
  const sent = await looked();

  await deck.getByRole("button", { name: "Share this moment" }).first().click();
  const url = new URL(await page.getByRole("textbox", { name: "Link" }).inputValue());
  await page.goto(`${url.pathname}${url.search}`);
  await expect(deck).toBeVisible({ timeout: 150_000 });
  // The same storm, cut open where the sender's cut stood, once the radar's storms are in.
  await expect(inspecting.getByRole("radio", { name: "Cut open" })).toBeChecked({ timeout: 60_000 });
  await expect(depth).toHaveText("+3.0 km");
  const received = await looked();
  expect(received.mode).toBe("cut");
  expect(received.lon).toBeCloseTo(sent.lon, 3);
  expect(received.lat).toBeCloseTo(sent.lat, 3);
  expect(received.cut.facingDeg).toBeCloseTo(sent.cut.facingDeg, 3);
  expect(received.cut.pushKm).toBe(3);
});

test("with the radar beams switched on in the settings, a storm looked into has beams from the radars that saw it, which go when it is let go",
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
    test.setTimeout(300_000);
    await noGeocoder(page);
    await emptyAircraft(page);
    const deck = page.getByRole("region", { name: "Flight deck" });
    const settings = page.getByRole("region", { name: "Settings" });
    const beams = () => page.evaluate(() => {
      const rays = (window as any).flightPilot.telemetry.rays;
      return rays ? rays.beams.map((beam: any) => beam.radar.name) : null;
    });
    // The radars' names at the beams' far ends: shown, as the deck shows them, for those on the screen.
    const shownRadars = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".flight-deck .radar")]
      .filter((label) => Number(getComputedStyle(label).opacity) > 0)
      .map((label) => label.querySelector("span")?.textContent ?? ""));

    // West towards the recorded storms over the Gulf of Lion, which France's radars saw from all round.
    await page.goto("/meteoair.html?latLonZ=43.30000,4.40000,7.00&fly=43.3000,4.7000&hdg=265&alt=FL120&spd=280kt&view=outside");
    await expect(deck).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await expect.poll(() => page.evaluate(() => (window as any).flightPilot.telemetry.marks.length), { timeout: 60_000 }).toBeGreaterThan(0);

    // Off unless asked for: a storm looked into has none.
    await page.keyboard.press("KeyI");
    await expect.poll(() => page.evaluate(() => Boolean((window as any).flightPilot.inspected))).toBe(true);
    expect(await beams()).toBeNull();

    // Switched on in the settings, the storm already looked into gets its beams.
    await deck.getByRole("button", { name: "Settings" }).click();
    const beamsSwitch = settings.getByRole("switch", { name: /Radar beams/ });
    await expect(beamsSwitch).not.toBeChecked();
    await beamsSwitch.click();
    await expect(beamsSwitch).toBeChecked();
    await expect.poll(async () => (await beams())?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    const names = (await beams())!;
    expect(names.every((name: string) => name.length > 0 && name === name.trim())).toBe(true);
    await expect.poll(async () => (await shownRadars()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect((await shownRadars()).every((name) => names.includes(name))).toBe(true);
    // Kept for the next flight.
    expect(await page.evaluate(() => localStorage.getItem("meteoairSettings"))).toContain("\"radarBeams\":true");
    await settings.getByRole("button", { name: "Close the settings" }).click();
    await expect(settings).toBeHidden();

    // Through cut open and peeled, and let go of: the beams go with it.
    for (let press = 0; press < 3; press += 1) await page.keyboard.press("KeyI");
    await expect.poll(beams).toBeNull();
    await expect.poll(async () => (await shownRadars()).length).toBe(0);
  });

test("the page loads nothing of the flight but its menu music, the plan only the aircraft it shows: the rest comes at take-off, with the loading card",
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
    test.setTimeout(240_000);
    await noGeocoder(page);
    const asked: string[] = [];
    page.on("request", (request) => {
      if (/\/(models\/a320\/|audio\/(theme|tension))/.test(request.url())) asked.push(request.url());
    });
    let release = () => {};
    await emptyAircraft(page, new Promise<void>((resolve) => { release = resolve; }));
    await page.goto(`/meteoair.html?${VIEW}`);
    await expect(board(page)).toBeVisible({ timeout: 30_000 });
    // Read for a while: nothing large comes.
    await page.waitForTimeout(3_000);
    expect(asked).toEqual([]);
    // The tech demo is said, and a desktop's connection is not warned of.
    await expect(landing(page)).toContainText("Tech demo");
    await expect(landing(page).locator(".note.data")).toHaveCount(0);
    // Pressed: on to the plan at once, which fetches the aircraft its preview turns, and nothing else large.
    await board(page).click();
    const plan = page.getByRole("region", { name: "Flight plan" });
    await expect(plan).toBeVisible({ timeout: 120_000 });
    await expect(plan.getByRole("button", { name: /^Music (on|off)$/ })).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(asked.filter((url) => !url.includes("/models/a320/"))).toEqual([]);
    await expect(plan.getByRole("button", { name: "Take off" })).not.toHaveAttribute("title", /\d+%/);
    // Taking off loads it, the loading card counting, and the flight starts once it is in.
    await plan.getByRole("button", { name: "Take off" }).click();
    await expect(page.getByRole("dialog", { name: "Preparing the flight" })).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => asked.some((url) => url.includes("/models/a320/"))).toBe(true);
    release();
    await expect(page.getByRole("region", { name: "Flight deck" })).toBeVisible({ timeout: 90_000 });
  });

test("the deck's sound button is the plan's switch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
  test.setTimeout(240_000);
  await noGeocoder(page);
  await emptyAircraft(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await board(page).click();
  const plan = page.getByRole("region", { name: "Flight plan" });
  await expect(plan).toBeVisible({ timeout: 120_000 });
  // Off in the plan, off in the flight, and remembered.
  await plan.getByRole("button", { name: /^Music (on|off)$/ }).click();
  await plan.getByRole("button", { name: "Take off" }).click();
  await expect(page.getByRole("region", { name: "Flight deck" })).toBeVisible({ timeout: 90_000 });
  const sound = page.getByRole("region", { name: "Flight deck" }).getByRole("button", { name: "Music on" });
  const muted = await page.evaluate(() => localStorage.getItem("studioFlightMuted"));
  await expect(sound).toHaveAttribute("aria-pressed", muted === "1" ? "false" : "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", muted === "1" ? "true" : "false");
});

test("a link that asks for no flight anyone can fly is the page as ever", async ({ page }) => {
  await page.goto(`/meteoair.html?${VIEW}&fly=here`);
  await expect(landing(page)).toBeVisible({ timeout: 30_000 });
  await expect(board(page)).toBeVisible();
});

test("a hash that starts asking for the flight's page loads it", async ({ page }) => {
  await page.goto(`/?${VIEW}`);
  await expect(page.locator("#map canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(landing(page)).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "#meteoair"; });
  await expect(landing(page)).toBeVisible({ timeout: 30_000 });
});
