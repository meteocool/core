import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./test";
import { curtainUp, emptyAircraft, noGeocoder } from "./app";
import { serveArchive } from "./archive";

/**
 * The flight on its side (lib/sideways.ts): in the apps, whose web view
 * stays upright, the flight's page, its plan and the flight are laid out
 * landscape and drawn a quarter turn round, and every finger is read in the
 * picture as drawn. Tried here as the page is forced to it (`?sideways`) on
 * a phone held upright, by real touches: the picture's top at the screen's
 * right edge, so a finger moving down the screen moves right across the
 * picture.
 */
const VIEW = "latLonZ=43.30000,4.60000,7.00";

// The plan lists the days the archive keeps, so it asks `/v3/archive`, which is never recorded.
test.beforeEach(async ({ page }) => { await serveArchive(page); });
const PHONE = { width: 390, height: 844 };

const landing = (page: Page) => page.locator(".landing");
const deck = (page: Page) => page.getByRole("region", { name: "Flight deck" });
const flightPlan = (page: Page) => page.getByRole("region", { name: "Flight plan" });

/** How the picture is turned: 90 with its top at the screen's right edge, -90 the other way, 0 upright. */
const turnOf = (page: Page) => page.evaluate(() => {
  const classes = document.documentElement.classList;
  return classes.contains("mc-sideways-cw") ? 90 : classes.contains("mc-sideways-ccw") ? -90 : 0;
});

/** A point of the picture, CSS pixels from its top left, as it is drawn on the screen. */
function onScreen([x, y]: [number, number], turn: number): [number, number] {
  if (turn === 90) return [PHONE.width - y, x];
  if (turn === -90) return [y, PHONE.height - x];
  return [x, y];
}

/** An element's box in the picture. */
const boxOf = (page: Page, selector: string) => page.evaluate((query) => {
  const rect = document.querySelector(query)!.getBoundingClientRect();
  const classes = document.documentElement.classList;
  if (classes.contains("mc-sideways-cw")) return { x: rect.top, y: innerWidth - rect.right, width: rect.height, height: rect.width };
  if (classes.contains("mc-sideways-ccw")) return { x: innerHeight - rect.bottom, y: rect.left, width: rect.height, height: rect.width };
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}, selector);

/**
 * A finger put down and moved along points of the picture, still down at the
 * end; the function returned lifts it. With `beside`, a second finger as
 * far from the first in the picture, moving with it.
 */
async function drag(page: Page, cdp: CDPSession, points: Array<[number, number]>, beside?: [number, number]): Promise<() => Promise<void>> {
  const turn = await turnOf(page);
  const fingers = ([x, y]: [number, number]) => [
    { x: onScreen([x, y], turn)[0], y: onScreen([x, y], turn)[1], id: 1 },
    ...(beside ? [{ x: onScreen([x + beside[0], y + beside[1]], turn)[0], y: onScreen([x + beside[0], y + beside[1]], turn)[1], id: 2 }] : []),
  ];
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(first) });
  for (const point of rest) {
    // A finger's moves come a frame or two apart.
    await page.waitForTimeout(30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(point) });
  }
  // The browser hands a move to the page with the next frame: read on before that, it is the move before.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return async () => { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
}

/** What the touch controls ask of the aircraft now. */
const touchInput = (page: Page) => page.evaluate(() => ({ roll: 0, pitch: 0, yaw: 0, throttle: 0, ...(window as any).flightPilot.keys.touch }));

test.describe("a phone held upright, the page forced on its side", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("upright without being asked: a phone's browser turns the page itself", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the phone is Chromium's, for its touches");
    await page.goto(`/meteoair.html?${VIEW}`);
    await expect(landing(page)).toBeVisible({ timeout: 30_000 });
    expect(await turnOf(page)).toBe(0);
  });

  test("the page, its plan and the flight are drawn on their side, and a finger works them where it is", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the phone is Chromium's, for its touches, and the 3D map's first bring-up is tried there");
    test.setTimeout(180_000);
    await noGeocoder(page);
    await emptyAircraft(page);
    const cdp = await page.context().newCDPSession(page);
    await page.goto(`/meteoair.html?sideways&${VIEW}`);

    // The page: laid out landscape, the top of the phone to the left.
    await expect(landing(page)).toBeVisible({ timeout: 30_000 });
    expect(await turnOf(page)).toBe(90);
    expect(await page.evaluate(() => [document.body.clientWidth, document.body.clientHeight])).toEqual([PHONE.height, PHONE.width]);
    // The radar map is in its place among the page's words, scrolled to, and moves the way the finger goes across the picture.
    await page.evaluate(() => document.querySelector(".landing .window")!.scrollIntoView({ block: "center" }));
    await expect.poll(() => page.evaluate(() => {
      const map = document.getElementById("map")!;
      return JSON.stringify((window as any).lm.maps[0].getSize()) === JSON.stringify([map.clientWidth, map.clientHeight]);
    })).toBe(true);
    await page.evaluate(() => new Promise((resolve) => { (window as any).lm.maps[0].once("rendercomplete", resolve); (window as any).lm.maps[0].render(); }));
    const center = () => page.evaluate(() => (window as any).lm.maps[0].getView().getCenter() as number[]);
    const before = await center();
    const map = await boxOf(page, "#map");
    const across = (share: number): [number, number] => [map.x + map.width * share, map.y + map.height / 2 - 30];
    // Set into the page, the map moves under two fingers, which go across the picture together.
    const lift = await drag(page, cdp, [across(0.3), across(0.35), across(0.45), across(0.55)], [0, 60]);
    await lift();
    const after = await center();
    // Dragged east across the picture, the map shows what is to the west: its centre goes west, not north or south.
    expect(after[0]).toBeLessThan(before[0]);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(Math.abs(after[0] - before[0]) / 10);

    // The plan: a slider slid along by a finger.
    await page.getByRole("button", { name: "Plan a flight" }).tap();
    await expect(flightPlan(page)).toBeVisible({ timeout: 60_000 });
    const level = page.locator("#preflight-level");
    const track = await boxOf(page, "#preflight-level");
    await (await drag(page, cdp, [
      [track.x + 2, track.y + track.height / 2], [track.x + track.width / 2, track.y + track.height / 2],
      [track.x + track.width - 2, track.y + track.height / 2],
    ]))();
    await expect(level).toHaveValue(await level.getAttribute("max") ?? "");

    // Off, and paused, for the controls to be read as they are held.
    await flightPlan(page).getByRole("button", { name: "Take off" }).tap();
    await expect(deck(page)).toBeVisible({ timeout: 90_000 });
    // A finger on take-off's black reaches nothing under it.
    await curtainUp(page);
    expect(await turnOf(page)).toBe(90);
    await page.evaluate(() => (window as any).flightPilot.paused || (window as any).flightPilot.act("pause"));
    // No word about turning the phone: it is turned.
    await expect(page.getByText("Turn your phone")).toHaveCount(0);

    const stick = await boxOf(page, ".touch .stick");
    const middle: [number, number] = [stick.x + stick.width / 2, stick.y + stick.height / 2];
    // Right across the picture rolls right.
    let release = await drag(page, cdp, [middle, [middle[0] + 30, middle[1]], [middle[0] + 60, middle[1]]]);
    let asked = await touchInput(page);
    expect(asked.roll).toBeGreaterThan(0.1);
    expect(asked.pitch).toBe(0);
    await release();
    // Down the picture is the stick pulled back: nose up.
    release = await drag(page, cdp, [middle, [middle[0], middle[1] + 30], [middle[0], middle[1] + 60]]);
    asked = await touchInput(page);
    expect(asked.pitch).toBeGreaterThan(0.1);
    expect(asked.roll).toBe(0);
    await release();

    // The rudder: right is right.
    const rudder = await boxOf(page, ".touch .rudder");
    const pedals: [number, number] = [rudder.x + rudder.width / 2, rudder.y + rudder.height / 2];
    release = await drag(page, cdp, [pedals, [pedals[0] + 20, pedals[1]], [pedals[0] + 40, pedals[1]]]);
    expect((await touchInput(page)).yaw).toBeGreaterThan(0.5);
    await release();

    // The lever, pushed up the picture to the top: more thrust.
    const lever = await boxOf(page, ".touch .lever");
    release = await drag(page, cdp, [
      [lever.x + lever.width / 2, lever.y + lever.height * 0.6], [lever.x + lever.width / 2, lever.y + lever.height * 0.3],
      [lever.x + lever.width / 2, lever.y + 2],
    ]);
    expect((await touchInput(page)).throttle).toBeGreaterThan(0);
    await release();

    // The phone held the other way round: the picture turns over with it, and right is still right.
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 0, gamma: 80 })));
      await page.waitForTimeout(120);
    }
    await expect.poll(() => turnOf(page)).toBe(-90);
    const turned = await boxOf(page, ".touch .stick");
    const centre: [number, number] = [turned.x + turned.width / 2, turned.y + turned.height / 2];
    release = await drag(page, cdp, [centre, [centre[0] + 30, centre[1]], [centre[0] + 60, centre[1]]]);
    expect((await touchInput(page)).roll).toBeGreaterThan(0.1);
    await release();

    // Leaving comes down on the plan, still on its side: the page is the flight's.
    await deck(page).getByRole("button", { name: "Leave" }).tap();
    await page.getByRole("alertdialog").getByRole("button", { name: /End flight/ }).tap();
    await expect(flightPlan(page)).toBeVisible({ timeout: 30_000 });
    expect(await turnOf(page)).toBe(-90);
  });
});
