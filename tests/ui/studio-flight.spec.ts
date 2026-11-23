import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { curtainUp, emptyAircraft } from "./app";

/**
 * Studio's flight: the 3D map from the cockpit of an airliner. On a desktop
 * only, as Studio is.
 *
 * The recording's volumes are blank tiles and its map tiles blank, so
 * nothing here is about what the view looks like; it is about the mode: the
 * flight deck taking Studio's place, the camera set free and flown by the
 * keys, and everything put back exactly on landing.
 */
/* From straight above, as studio.spec.ts opens it: a tilted map is several
   times the tiles, drawn here by a software renderer. */
const MAP_3D = "/?layer=cells3d&latLonZ=50.50000,9.50000,7.00&pitch=0&bearing=0";

const panel = (page: Page) => page.getByRole("region", { name: "meteocool Studio" });
const timeline = (page: Page) => page.getByRole("region", { name: "Time and scene" });
const deck = (page: Page) => page.getByRole("region", { name: "Flight deck" });
const throttle = (page: Page) => deck(page).getByLabel("Throttle");
const flightPlan = (page: Page) => page.getByRole("region", { name: "Flight plan" });
const leaveAsk = (page: Page) => page.getByRole("alertdialog", { name: "End the flight?" });
/** The card of the controls, up from takeoff until the aircraft is first flown. */
const help = (page: Page) => page.getByRole("region", { name: "Flying", exact: true });

/** From Studio's panel to the air: the plan as it is proposed, and off. */
async function takeOff(page: Page): Promise<void> {
  await panel(page).getByRole("button", { name: "Fly", exact: true }).click();
  await expect(flightPlan(page)).toBeVisible();
  await flightPlan(page).getByRole("button", { name: "Take off" }).click();
}

/** The 3D map's camera as MapLibre has it. */
const camera = (page: Page) => page.evaluate(() => {
  const { gl } = (window as any).lm.getCapability("cells3d");
  return {
    pitch: gl.getPitch() as number,
    roll: gl.getRoll() as number,
    maxPitch: gl.getMaxPitch() as number,
    clamped: gl.getCenterClampedToGround() as boolean,
    handlers: ["dragPan", "scrollZoom", "dragRotate", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"]
      .map((name) => gl[name].isEnabled() as boolean),
  };
});

test.describe("on a desktop", () => {
  test.skip(({ isMobile }) => isMobile, "Studio is a desktop's");
  // One flight at a time: three at once, each drawn by a software renderer,
  // take each other's frames and time out on a busy machine.
  test.describe.configure({ mode: "default" });
  // A small window: the flight's view to the horizon is the most a software
  // renderer is asked to draw anywhere in the suite, and nothing here is
  // about how much of it there is.
  test.use({ viewport: { width: 1024, height: 640 } });

  // An empty aircraft: half a million triangles drawn by a software
  // renderer leave the flight a frame every few seconds, and nothing here is
  // about what the aircraft looks like.
  test.beforeEach(async ({ page }) => {
    await emptyAircraft(page);
    // Studio's tools are a setting, off unless turned on.
    await page.addInitScript(() => localStorage.setItem("studioEnabled", "true"));
  });

  test("with Studio off, the 3D map's Fly opens the flight's plan, and putting it away is the 3D map again", async ({ page }) => {
    test.slow();
    await page.addInitScript(() => localStorage.setItem("studioEnabled", "false"));
    await page.goto(MAP_3D);
    const fly = page.getByRole("button", { name: "Fly", exact: true });
    await expect(fly).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Studio", exact: true })).toHaveCount(0);
    await fly.click();
    await expect(flightPlan(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toHaveCount(0);
    await flightPlan(page).getByRole("button", { name: "Back to meteocool" }).click();
    await expect(flightPlan(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(fly).toBeVisible();
  });

  test("taken off before the flight has loaded, a loading screen says how far, and the flight starts once it has", async ({ page }) => {
    test.slow();
    let release = () => {};
    // Over the empty aircraft of every test here: held until the test lets it come.
    await emptyAircraft(page, new Promise<void>((resolve) => { release = resolve; }));
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await takeOff(page);
    const loading = page.getByRole("dialog", { name: "Preparing the flight" });
    await expect(loading).toBeVisible();
    await expect(loading.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /^\d+$/);
    await expect(deck(page)).toHaveCount(0);
    release();
    await expect(deck(page)).toBeVisible({ timeout: 30_000 });
    await expect(loading).toHaveCount(0);
  });

  test("Fly puts the flight deck up and flies the camera, and Escape brings Studio back as it was", async ({ page }) => {
    // The 3D map brought up, then Studio's chunk: slow on a loaded machine.
    test.slow();
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await panel(page).getByRole("radio", { name: "Glow" }).click();
    const where = () => new URL(page.url()).searchParams.get("latLonZ");
    const tookOff = where();

    // Fly opens the flight's plan first: a chart, a briefing, and nothing flown yet.
    await panel(page).getByRole("button", { name: "Fly", exact: true }).click();
    await expect(flightPlan(page)).toBeVisible();
    await expect(panel(page)).toBeHidden();
    // (Written whatever the window: shown only where it fits without scrolling, which this one is too short for.)
    await expect(flightPlan(page).getByText("NOT FOR NAVIGATION")).toBeAttached();
    expect((await camera(page)).clamped).toBe(true);
    // Cancelled, Studio is back as it was; planned again and taken off, the deck is up.
    await flightPlan(page).getByRole("button", { name: "Cancel" }).click();
    await expect(panel(page)).toBeVisible();
    await takeOff(page);
    await expect(deck(page)).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await expect(timeline(page)).toBeHidden();
    // The free camera: not held to the ground, at the horizon, nothing a hand can move it by.
    await expect.poll(async () => (await camera(page)).clamped).toBe(false);
    const flying = await camera(page);
    expect(flying.pitch).toBeGreaterThan(75);
    expect(flying.pitch).toBeLessThan(105);
    expect(flying.maxPitch).toBe(180);
    expect(flying.handlers).toEqual(flying.handlers.map(() => false));
    // The air is nowhere a link can stand: the address keeps where the flight took off.
    await page.waitForTimeout(1500);
    expect(where()).toBe(tookOff);

    // W held opens the throttle.
    await expect(throttle(page)).toHaveText(/^\d+%$/);
    const opening = Number((await throttle(page).textContent())!.replace("%", ""));
    await page.keyboard.down("KeyW");
    // By any amount: how far it gets is the frames the machine managed, which is not the flight's doing.
    await expect.poll(async () => Number((await throttle(page).textContent())!.replace("%", "")), { timeout: 30_000 })
      .toBeGreaterThan(Math.min(opening, 99));
    await page.keyboard.up("KeyW");
    // The aircraft is the map's to draw while flying, and the mouse turns the eye in its seat.
    const aircraft = () => page.evaluate(() => Boolean((window as any).lm.getCapability("cells3d").gl.getLayer("flight-aircraft")));
    const bearing = () => page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.getBearing() as number);
    expect(await aircraft()).toBe(true);
    const ahead = await bearing();
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(700, 300, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs(await bearing() - ahead), { timeout: 30_000 }).toBeGreaterThan(10);
    // V stands the eye outside, level whatever the aircraft does.
    await page.keyboard.press("v");
    await expect(deck(page)).toHaveClass(/view-outside/);
    // Studio's own keys do nothing meanwhile: Space is the speed brake, not play.
    await page.keyboard.press("k");
    await expect(deck(page)).toBeVisible();

    // Escape does not end the flight: it asks, and Escape again flies on.
    await page.keyboard.press("Escape");
    await expect(leaveAsk(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(leaveAsk(page)).toBeHidden();
    await expect(deck(page)).toBeVisible();
    // Asked again and answered with Enter, it ends.
    await page.keyboard.press("Escape");
    await expect(leaveAsk(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(deck(page)).toBeHidden();
    await expect(panel(page)).toBeVisible();
    await expect(timeline(page)).toBeVisible();
    expect(await aircraft()).toBe(false);
    const landed = await camera(page);
    expect(landed.maxPitch).toBe(89);
    expect(landed.roll).toBe(0);
    expect(landed.clamped).toBe(true);
    expect(landed.pitch).toBeLessThanOrEqual(89);
    expect(landed.handlers).toEqual(landed.handlers.map(() => true));
    // The style Studio had before the flight, and no keyframe made by the K pressed in flight.
    await expect(panel(page).getByRole("radio", { name: "Glow" })).toHaveAttribute("aria-checked", "true");
    await expect(timeline(page).locator(".marks i")).toHaveCount(0);
  });

  test("the Leave button lands too, and closing Studio while flying puts the map back outside it", async ({ page }) => {
    test.slow();
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await takeOff(page);
    await expect(deck(page)).toBeVisible();
    await deck(page).getByRole("button", { name: "Leave" }).click();
    await leaveAsk(page).getByRole("button", { name: "End flight" }).click();
    await expect(panel(page)).toBeVisible();

    await takeOff(page);
    await expect(deck(page)).toBeVisible();
    // Back, as it leaves Studio from anywhere.
    await page.goBack();
    await expect(deck(page)).toBeHidden();
    await expect(panel(page)).toBeHidden();
    const outside = await camera(page);
    expect(outside.maxPitch).toBe(84);
    expect(outside.roll).toBe(0);
    expect(outside.clamped).toBe(true);
    expect(outside.handlers).toEqual(outside.handlers.map(() => true));
  });

  test("Fly from here on the map's menu takes off from that place without the plan, and ending it is that map again", async ({ page }) => {
    test.slow();
    // The menu's heading asks where it is; nowhere, here.
    await page.route("**/geocoding/**", (route) => route.fulfill({ status: 404, json: {} }));
    await page.route("https://api.bigdatacloud.net/**", (route) => route.fulfill({ status: 404, json: {} }));
    const VIEW = "50.50000,9.50000,7.00";
    await page.goto(`/?latLonZ=${VIEW}`);
    const map = page.locator("#map");
    await expect(map.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    // The middle of the map's element, which is where its view stands.
    const box = (await map.boundingBox())!;
    const entry = page.getByRole("menuitem", { name: /Fly from here with meteoair/ });
    // Again until the map takes it: on a busy machine its first seconds go to bringing it up.
    await expect(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await expect(entry).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await entry.click();
    await expect(deck(page)).toBeVisible({ timeout: 120_000 });
    // No plan on the way, and none of Studio's tools.
    await expect(flightPlan(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    const plan = await page.evaluate(() => {
      const { flightPlan: flown } = (window as any).flightPilot;
      return { lat: flown.lat, lon: flown.lon, feet: flown.altitude * 3.28084, tas: flown.tas, view: flown.view };
    });
    // From where it was asked, at a level for a storm and rather fast.
    expect(Math.abs(plan.lat - 50.5)).toBeLessThan(0.05);
    expect(Math.abs(plan.lon - 9.5)).toBeLessThan(0.05);
    expect(plan.feet).toBeGreaterThanOrEqual(8000);
    expect(plan.feet).toBeLessThanOrEqual(41_000);
    expect(plan.tas).toBeGreaterThan(150);
    expect(plan.view).toBe("cockpit");
    // Asked whether to end it, once take-off's black has lifted, the way back is said to be the map; with a link to this moment meanwhile.
    await curtainUp(page);
    await page.keyboard.press("Escape");
    await expect(leaveAsk(page)).toContainText("back to the map");
    await expect(leaveAsk(page).getByRole("button", { name: "Share this moment" })).toBeVisible();
    await page.keyboard.press("Enter");
    // Ended: the flat map, where it was looking, and not Studio.
    await expect(deck(page)).toBeHidden();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).lm.currentCap)).toBe("radar");
    await expect.poll(() => new URL(page.url()).searchParams.get("latLonZ")).toBe(VIEW);
  });

  test("looking level from the seat, the ground is a few hundred tiles, not thousands", async ({ page }) => {
    test.slow();
    // The relief and the imagery draped on it: every tile of either the map asks for.
    let asked = 0;
    page.on("request", (request) => {
      if (/tiles\.versatiles\.org\/tiles\/satellite-raster|map\.meteocool\.com\/mapterhorn-|tiles\.mapterhorn\.com\//.test(request.url())) asked += 1;
    });
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await takeOff(page);
    await expect(deck(page)).toBeVisible();
    await curtainUp(page);
    const pitch = () => page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.getPitch() as number);
    // Cruising, the eye looks a little down.
    await expect.poll(pitch).toBeLessThan(89);
    // The head raised until the eye looks level, which a storm's updraft and rough air do too.
    await expect(async () => {
      await page.evaluate(() => {
        const pilot = (window as any).flightPilot;
        const map = (window as any).lm.getCapability("cells3d").gl;
        pilot.head = { ...pilot.head, pitch: pilot.head.pitch + 90 - map.getPitch() };
      });
      await expect.poll(pitch, { timeout: 3000 }).toBeGreaterThan(89.7);
      expect(await pitch()).toBeLessThan(90.3);
    }).toPass({ timeout: 30_000 });
    // Level, the map once asked for every tile to the horizon at the sharpest zoom: near 900 here in a few frames of a
    // software renderer, thousands on a real GPU, and the page held for seconds. Now about a hundred.
    const level = asked;
    await page.waitForTimeout(8000);
    expect(asked - level).toBeLessThan(500);
  });

  test("the flight starts with the radar off the ground, O paints it there and back, J sets the flaps, and landing puts it back", async ({ page }) => {
    test.slow();
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    const offGround = () => page.evaluate(() => (window as any).lm.getCapability("cells3d").radarOffGround as boolean);
    await panel(page).getByRole("button", { name: "Fly", exact: true }).click();
    await expect(flightPlan(page)).toBeVisible();
    // The briefing reads the plan back, the cloud base among it.
    await expect(flightPlan(page).getByText("CLD BASE")).toBeAttached();
    // The plan asks nothing of how the map is drawn: the radar is off the ground, which O paints there and takes off again.
    await expect(flightPlan(page).getByRole("combobox", { name: "Basemap" })).toHaveCount(0);
    await flightPlan(page).getByRole("button", { name: "Take off" }).click();
    await expect(deck(page)).toBeVisible();
    await expect.poll(offGround).toBe(true);
    await page.keyboard.press("o");
    await expect.poll(offGround).toBe(false);
    await page.keyboard.press("o");
    await expect.poll(offGround).toBe(true);
    // How fast the flight is drawn is on the deck.
    await expect(deck(page).getByText(/\d+ fps/)).toBeVisible({ timeout: 15_000 });
    // A step of flaps: the lever's place reads out while they travel and after.
    await page.keyboard.press("j");
    await expect(deck(page).getByLabel("Flaps")).toHaveText("1");
    await curtainUp(page);
    await page.keyboard.press("Escape");
    await expect(leaveAsk(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    expect(await offGround()).toBe(false);
  });

  test("the controls' card stays up until a key first flies the aircraft, and its close button and H put it away and back", async ({ page }) => {
    test.slow();
    await page.goto(MAP_3D);
    await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await takeOff(page);
    await expect(deck(page)).toBeVisible();
    await curtainUp(page);
    await expect(help(page)).toBeVisible();
    // Neither the time, nor the outside view, a click on it, the music or Shift alone put it away: none of them flies.
    await page.keyboard.press("v");
    await expect(deck(page)).toHaveClass(/view-outside/);
    await page.mouse.click(700, 120);
    await deck(page).getByRole("button", { name: "Music on" }).click();
    await page.keyboard.press("Shift");
    await page.keyboard.press("Control+ArrowUp");
    await page.waitForTimeout(8000);
    await expect(help(page)).toBeVisible();
    // Its close button puts it away, and the corner's button brings it back.
    await help(page).getByRole("button", { name: "Close help" }).click();
    await expect(help(page)).toBeHidden();
    await deck(page).getByRole("button", { name: "Controls" }).click();
    await expect(help(page)).toBeVisible();
    // The first key that flies puts it away; H brings it back.
    await page.keyboard.press("ArrowUp");
    await expect(help(page)).toBeHidden();
    await page.keyboard.press("h");
    await expect(help(page)).toBeVisible();
  });

  test.describe("with a touch screen", () => {
    test.use({ hasTouch: true });
    // A laptop's touch screen beside its trackpad. Chromium's touch emulation
    // makes the finger the only pointer, a tablet's coarse one that cannot
    // hover, and a tablet is a handheld, offered no Studio; so the page is
    // told what a touch laptop's primary pointer says: fine, and hovering.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const matchMedia = window.matchMedia.bind(window);
        const yes = "(min-width: 0px)";
        const no = "(max-width: 0px)";
        window.matchMedia = (query: string) => matchMedia(query
          .replace(/\((any-)?pointer:\s*fine\)/g, yes)
          .replace(/\((any-)?pointer:\s*coarse\)/g, no)
          .replace(/\((any-)?hover:\s*hover\)/g, yes)
          .replace(/\((any-)?hover:\s*none\)/g, no));
      });
    });

    test("the controls' card stays up until a finger is first on a flight control", async ({ page }) => {
      test.slow();
      await page.goto(MAP_3D);
      await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 90_000 });
      await expect(panel(page)).toBeVisible({ timeout: 20_000 });
      await takeOff(page);
      await expect(deck(page)).toBeVisible();
      await curtainUp(page);
      await page.keyboard.press("v");
      await expect(deck(page)).toHaveClass(/view-outside/);
      // A finger on the view brings the touch controls up, and flies nothing.
      await page.touchscreen.tap(700, 120);
      await expect(page.getByRole("group", { name: "Touch controls" })).toBeVisible();
      await expect(help(page)).toBeVisible();
      // A thumb on the stick, even held still in its middle, is flying.
      const stick = await page.getByLabel("Stick: nose up and down, roll left and right").boundingBox();
      await page.touchscreen.tap(stick!.x + stick!.width / 2, stick!.y + stick!.height / 2);
      await expect(help(page)).toBeHidden();
    });
  });
});
