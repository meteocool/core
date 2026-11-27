import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { curtainUp, emptyAircraft, noGeocoder, openRadar } from "./app";
import { RECORDED_STEP, serveArchive } from "./archive";
import { boardAsked, scriptBoard, STAND_IN_CALLSIGN, STAND_IN_PILOT, TEST_TOKEN } from "./board";

/**
 * meteoair's board: a live flight goes on today's board, the cockpit shows
 * the board's score beside its own and the day's top twenty, and the board
 * failing never holds the flight up. And nothing of the board, Turnstile's
 * script included, is loaded or asked for before a flight goes on it.
 *
 * The board and Turnstile are stood in for (board.ts).
 */
const VIEW = "latLonZ=50.50000,9.50000,6.00";
const FLIGHT = `/meteoair.html?${VIEW}&fly=50.4000,9.6000&hdg=090&alt=FL120&spd=280kt&view=outside`;

const deck = (page: Page) => page.getByRole("region", { name: "Flight deck" });
const boardReadout = (page: Page) => deck(page).getByRole("button", { name: /^This flight on today's board/ });
const boardCard = (page: Page) => page.getByRole("region", { name: "Today's board" });
const asked = (page: Page) => boardAsked(page).map((request) => `${request.method} ${request.path.replace(/\/flights\/[0-9a-f]+\//, "/flights/{id}/")}`);
const flown = (page: Page) => page.evaluate(() => (window as any).flightPilot?.telemetry.time as number | undefined);

/** Every storage key the page reads, from before its first script. */
async function watchStorage(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const read: string[] = [];
    (window as any).storageRead = read;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      read.push(key);
      return getItem.call(this, key);
    };
  });
  return () => page.evaluate(() => (window as any).storageRead as string[]);
}

/** Every request the page makes, by address. */
function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("websocket", (socket) => urls.push(socket.url()));
  return urls;
}

const boardish = (url: string) => /\/v3\/air(\/|$)|challenges\.cloudflare\.com|\/flight\/board\/|meteoairBoard/.test(url);

test("the main map loads nothing of the board and asks nothing of it", async ({ page }) => {
  const keys = await watchStorage(page);
  const urls = watchRequests(page);
  await openRadar(page);
  // Long enough for the map's own first requests and anything lazy behind them.
  await page.waitForTimeout(4000);
  expect(urls.filter(boardish)).toEqual([]);
  expect(boardAsked(page)).toEqual([]);
  expect(await keys()).not.toContain("meteoair.pilot");
});

test("meteoair's page before a flight loads nothing of the board and asks nothing of it", async ({ page }) => {
  await serveArchive(page);
  const keys = await watchStorage(page);
  const urls = watchRequests(page);
  await page.goto(`/meteoair.html?${VIEW}`);
  await expect(page.locator(".landing")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  expect(urls.filter(boardish)).toEqual([]);
  expect(boardAsked(page)).toEqual([]);
  expect(await keys()).not.toContain("meteoair.pilot");
});

test.describe("in flight, on a desktop", () => {
  test.skip(({ isMobile }) => isMobile, "the 3D map's first bring-up is tried on a desktop");
  // One flight at a time: each is drawn by a software renderer.
  test.describe.configure({ mode: "default" });
  test.use({ viewport: { width: 1024, height: 640 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(240_000);
    await noGeocoder(page);
    await emptyAircraft(page);
    await serveArchive(page);
  });

  test("a live flight goes on the board: a pilot made, a flight started, its track sent, the board's score beside the cockpit's", async ({ page }) => {
    await page.goto(FLIGHT);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await expect.poll(() => asked(page), { timeout: 30_000 }).toContain("POST /flights");
    // The socket, for the day's board, opens on its own; of the rest:
    const requests = boardAsked(page).filter((request) => request.path !== "socket");
    // Turnstile's script first, then a pilot made with its token, then the flight started with another, as that pilot.
    expect(requests[0].path).toBe("turnstile");
    const made = requests.find((request) => request.path === "/pilots")!;
    expect(made.body).toEqual({ turnstile: TEST_TOKEN });
    expect(made.authorization).toBeNull();
    const started = requests.find((request) => request.path === "/flights")!;
    expect(started.body).toEqual({ turnstile: TEST_TOKEN });
    expect(started.authorization).toBe(`Bearer ${STAND_IN_PILOT}`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("meteoair.pilot") ?? "null")?.callsign)).toBe(STAND_IN_CALLSIGN);

    // The track, on a timer: samples of [t, lon, lat, altitude], each later than the last.
    await expect.poll(() => asked(page), { timeout: 45_000 }).toContain("POST /flights/{id}/track");
    const batch = boardAsked(page).find((request) => request.path.endsWith("/track"))!;
    const samples = batch.body!.samples as number[][];
    expect(samples.length).toBeGreaterThan(0);
    for (const [index, sample] of samples.entries()) {
      expect(sample).toHaveLength(4);
      if (index) expect(sample[0]).toBeGreaterThan(samples[index - 1][0]);
    }
    expect(samples[0][1]).toBeGreaterThan(9);
    expect(samples[0][2]).toBeGreaterThan(50);
    expect(batch.authorization).toBe(`Bearer ${STAND_IN_PILOT}`);

    // The board's score and rank beside the cockpit's; pressed, the day's board, the pilot's own entry marked.
    await expect(boardReadout(page)).toHaveText("1,234 · #2");
    await boardReadout(page).click();
    await expect(boardCard(page)).toBeVisible();
    await expect(boardCard(page)).toContainText(STAND_IN_CALLSIGN);
    const top = boardCard(page).getByRole("list", { name: "Today's top twenty" }).getByRole("listitem");
    await expect(top).toHaveCount(2);
    await expect(top.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(top.nth(0)).not.toHaveAttribute("aria-current", "true");
    await boardCard(page).getByRole("button", { name: "Close today's board" }).click();
    await expect(boardCard(page)).toHaveCount(0);

    // Ended in the cockpit, ended on the board.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "End the flight?" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(() => asked(page), { timeout: 30_000 }).toContain("POST /flights/{id}/end");
  });

  test("with the board out of reach the flight goes on, on the cockpit's score alone", async ({ page }) => {
    scriptBoard(page, { "POST /pilots": Array.from({ length: 20 }, () => "network" as const) });
    await page.goto(FLIGHT);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await expect.poll(() => asked(page), { timeout: 30_000 }).toContain("POST /pilots");
    const before = (await flown(page)) ?? 0;
    await expect.poll(async () => (await flown(page)) ?? 0, { timeout: 30_000 }).toBeGreaterThan(before + 2);
    await expect(boardReadout(page)).toHaveText("–");
    await boardReadout(page).click();
    await expect(boardCard(page)).toContainText("Can't reach the board just now");
    expect(asked(page)).not.toContain("POST /flights");
  });

  test("a check Turnstile's side refuses twice leaves the flight off the board, and says so", async ({ page }) => {
    scriptBoard(page, { "POST /flights": [{ status: 403, body: { detail: "turnstile" } }, { status: 403, body: { detail: "turnstile" } }] });
    await page.goto(FLIGHT);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await expect(deck(page).getByText("No board for this flight: the cockpit's score only")).toBeVisible({ timeout: 30_000 });
    await expect(boardReadout(page)).toHaveText("Off");
    expect(asked(page).filter((request) => request === "POST /flights")).toHaveLength(2);
    // And the flight flies on.
    const before = (await flown(page)) ?? 0;
    await expect.poll(async () => (await flown(page)) ?? 0, { timeout: 30_000 }).toBeGreaterThan(before + 1);
  });

  test("a check that has to ask the reader is on a card of the deck's; skipped, the flight is off the board", async ({ page }) => {
    await page.addInitScript(() => { (window as any).__turnstileAsks = true; });
    await page.goto(FLIGHT);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    const check = page.getByRole("region", { name: "Before this flight counts" });
    // Asked for the pilot: the card is up, and nothing has gone to the board.
    await expect(check).toBeVisible({ timeout: 30_000 });
    await expect(check).toContainText("Confirm you're human");
    expect(asked(page)).not.toContain("POST /pilots");
    await page.evaluate(() => (window as any).__turnstileAnswer());
    await expect.poll(() => asked(page), { timeout: 30_000 }).toContain("POST /pilots");
    // Asked again for the flight, and skipped this time: no flight on the board, and the deck says so.
    await expect(check).toBeVisible({ timeout: 30_000 });
    await check.getByRole("button", { name: "Skip the check" }).click();
    await expect(check).toBeHidden();
    await expect(deck(page).getByText("No board for this flight: the cockpit's score only")).toBeVisible({ timeout: 30_000 });
    await expect(boardReadout(page)).toHaveText("Off");
    expect(asked(page)).not.toContain("POST /flights");
  });

  test("a flight the board stops counting says so, and why", async ({ page }) => {
    scriptBoard(page, {
      "POST /flights/{id}/track": [{
        status: 409,
        body: { flight: "0123456789abcdef01234567", points: 300, rank: null, feats: [], clock: 30, refused_total: 61, ended: { at: "x", reason: "refused" } },
      }],
    });
    await page.goto(FLIGHT);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await expect(deck(page).getByText("The board stopped counting this flight: track refused"))
      .toBeVisible({ timeout: 45_000 });
    await expect(boardReadout(page)).toHaveText("300");
  });

  test("a flight through a past moment starts no board flight", async ({ page }) => {
    await page.goto(`${FLIGHT}&at=${new Date((RECORDED_STEP - 3600) * 1000).toISOString().slice(0, 16)}Z`);
    await expect(deck(page)).toBeVisible({ timeout: 150_000 });
    await curtainUp(page);
    await page.waitForTimeout(5000);
    expect(boardAsked(page)).toEqual([]);
    await expect(boardReadout(page)).toHaveCount(0);
  });
});
