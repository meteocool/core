import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { emptyAircraft, noGeocoder } from "./app";

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
  test.setTimeout(120_000);
  await noGeocoder(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await board(page).click();
  const plan = page.getByRole("region", { name: "Flight plan" });
  await expect(plan).toBeVisible({ timeout: 60_000 });
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
  test.setTimeout(150_000);
  await noGeocoder(page);
  // An empty aircraft: a software renderer draws the real one a frame every few seconds.
  await emptyAircraft(page);
  await page.goto(`/meteoair.html?${VIEW}&fly=50.4000,9.6000&hdg=090&alt=FL120&spd=280kt&view=outside`);
  const deck = page.getByRole("region", { name: "Flight deck" });
  // The storms waited for, with a word meanwhile; then in the air.
  await expect(page.getByRole("status").filter({ hasText: "Finding the storms" })).toBeVisible({ timeout: 90_000 });
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
  // Over, it comes down on the page's plan, and the address is the page's own again.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Flight plan" })).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).search).toBe(`?${VIEW}`);
  // And the plan on screen has a link of its own to give.
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
});

test("the page loads nothing of the flight but its menu music until the button: then the plan, with the rest loading behind it",
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
    test.setTimeout(120_000);
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
    // Pressed: on to the plan at once, the flight loading meanwhile, along the take-off button's foot.
    await board(page).click();
    const plan = page.getByRole("region", { name: "Flight plan" });
    await expect(plan).toBeVisible({ timeout: 60_000 });
    await expect(plan.getByRole("button", { name: /^Sound (on|off)$/ })).toBeVisible();
    await expect.poll(() => asked.some((url) => url.includes("/models/a320/"))).toBe(true);
    await expect(plan.getByRole("button", { name: "Take off" })).toHaveAttribute("title", /\d+%/);
    release();
    await expect(plan.getByRole("button", { name: "Take off" })).not.toHaveAttribute("title", /\d+%/, { timeout: 60_000 });
  });

test("taking off is at once once the plan has loaded the flight; the deck's sound button is the plan's switch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the 3D map's first bring-up is tried on a desktop");
  test.setTimeout(150_000);
  await noGeocoder(page);
  await emptyAircraft(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await board(page).click();
  const plan = page.getByRole("region", { name: "Flight plan" });
  await expect(plan).toBeVisible({ timeout: 60_000 });
  // Everything in while the plan is read: the take-off button stops counting.
  await expect(plan.getByRole("button", { name: "Take off" })).not.toHaveAttribute("title", /\d+%/, { timeout: 90_000 });
  // Off in the plan, off in the flight, and remembered.
  await plan.getByRole("button", { name: /^Sound (on|off)$/ }).click();
  await plan.getByRole("button", { name: "Take off" }).click();
  // Nothing left to wait for: no loading screen, the deck at once.
  await expect(page.getByRole("region", { name: "Flight deck" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("dialog", { name: "Preparing the flight" })).toHaveCount(0);
  const sound = page.getByRole("region", { name: "Flight deck" }).getByRole("button", { name: "Sound on" });
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
