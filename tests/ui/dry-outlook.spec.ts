import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./test";
import { noGeocoder, openRadar } from "./app";
import { fixtureFile, readRecording, type RecordedResponse } from "./offline";

/**
 * The dry-day outlook: what the weather models say for the reader's own
 * position, in the player's strip, when the radar has nothing there. Closed,
 * it stays away for a day, reloads included.
 */

/** Central Germany, inside the radar's reach. */
const HOME = { latitude: 50.5, longitude: 10 };
const DAY_MS = 24 * 3_600_000;

test.use({ geolocation: HOME, permissions: ["geolocation"] });

/** A week of open-meteo's hours with no rain in any model: "No rain in sight". */
async function dryWeek(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const models = (url.searchParams.get("models") ?? "").split(",");
  const variable = url.searchParams.get("hourly") ?? "precipitation";
  const start = Math.floor(readRecording().recordedAt / 3_600_000) * 3_600_000;
  const time = Array.from({ length: 168 }, (_, i) => new Date(start + i * 3_600_000).toISOString().slice(0, 16));
  const hourly: Record<string, unknown> = { time };
  const units: Record<string, string> = {};
  for (const id of models) {
    hourly[`${variable}_${id}`] = time.map(() => 0);
    units[`${variable}_${id}`] = "mm";
  }
  await route.fulfill({ json: { hourly, hourly_units: units } });
}

/**
 * The recorded timeseries, with every frame read as 0 dBZ at the reader's
 * position: dry. The recording itself has no reading there at all, which
 * says nothing either way and so does not count as dry.
 */
async function dryRadar(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const recorded = JSON.parse(readFileSync(fixtureFile("GET", url), "utf8")) as RecordedResponse;
  const json = recorded.json as { frames: Record<string, Record<string, unknown> | null> };
  for (const frame of Object.values(json.frames)) {
    if (frame) Object.assign(frame, { dbz: 0, dbzMin: 0, dbzMax: 0 });
  }
  await route.fulfill({ status: 200, json });
}

const outlook = (page: Page) => page.locator(".strip-dock").filter({ hasText: "No Rain in Sight" });

async function openDry(page: Page): Promise<void> {
  await noGeocoder(page);
  await page.route("**/v3/radar/timeseries**", dryRadar);
  await page.route("https://api.open-meteo.com/**", dryWeek);
  await openRadar(page, "/?layer=radar&latLonZ=50.50000,10.00000,8.00");
}

test("closed, the outlook stays away across a reload", async ({ page }) => {
  await openDry(page);
  await expect(outlook(page)).toBeVisible({ timeout: 20_000 });
  await outlook(page).getByRole("button", { name: "Close" }).click();
  await expect(outlook(page)).toBeHidden();

  await openRadar(page, page.url());
  // Long enough for it to have come back, had it been going to.
  await page.waitForTimeout(3_000);
  await expect(outlook(page)).toBeHidden();
});

test("a day after it was closed, the outlook is back", async ({ page }) => {
  await openDry(page);
  await expect(outlook(page)).toBeVisible({ timeout: 20_000 });
  await outlook(page).getByRole("button", { name: "Close" }).click();
  await expect(outlook(page)).toBeHidden();

  // The closing moved a day back, rather than the clock a day on: a day on,
  // the recorded radar would be a day old and the strip down for that.
  await page.evaluate((day) => {
    const at = Number(localStorage.getItem("dryOutlookDismissedAt"));
    localStorage.setItem("dryOutlookDismissedAt", String(at - day));
  }, DAY_MS);
  await openRadar(page, page.url());
  await expect(outlook(page)).toBeVisible({ timeout: 20_000 });
});
