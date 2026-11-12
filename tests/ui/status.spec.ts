import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, overlaps, statusPill, statusSheet, timeline } from "./app";
import { cutSocket, fixtureFile, readRecording, type RecordedResponse } from "./offline";

/**
 * What the map says when the backend's status (`GET /v3/status`) has
 * something late: the one notice above the tray, the pill and the sheet it
 * opens. Each test serves its own variant of the hand-written fixture
 * (fixtures/api/GET_v3_status.json, all `ok`).
 */

/** Central Germany, wholly inside DWD's reach on a desktop too. */
const GERMANY_VIEW = "/?layer=radar&latLonZ=50.50000,10.00000,8.00";
/** Central Poland: the Polish network's own ground, none of DWD's. */
const POLAND_VIEW = "/?layer=radar&latLonZ=52.00000,19.50000,8.00";
/** Bavaria, east of Munich: DWD's, with no Polish ground near. */
const BAVARIA_VIEW = "/?layer=radar&latLonZ=48.30000,11.80000,8.00";

const NOW = Math.floor(readRecording().recordedAt / 1000);

type Status = {
  server_time: number;
  replay: boolean;
  components: { kind: string; domain?: string; state: string; newest: number | null; since?: number }[];
  notices: { id: string; level: string; domains: string[] | null; starts: number; ends: number | null; text: Record<string, string> }[];
};

const recorded = (): Status => (
  (JSON.parse(readFileSync(fixtureFile("GET", new URL("http://localhost/v3/status")), "utf8")) as RecordedResponse).json as Status
);

/** The recorded status with `domain`'s radar down for the last hour. */
function radarDown(domain: string): Status {
  const status = recorded();
  status.components = status.components.map((component) => (component.kind === "radar" && component.domain === domain
    ? { ...component, state: "down", newest: NOW - 3600, since: NOW - 1800 }
    : component));
  return status;
}

async function serveStatus(page: Page, status: Status): Promise<void> {
  await page.route("**/v3/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) }));
}

const feedNotice = (page: Page) => page.getByText("Radar Data Not Coming In");
const warningNotice = (page: Page) => page.getByText("Warning", { exact: true });
const closeStrip = (page: Page) => page.locator(".strip-dock").getByRole("button", { name: "Close" });

test("with every component ok, nothing is said and the pill says Latest", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await expect(statusPill(page)).toHaveText("Latest");
  await expect(page.locator(".strip-dock")).toHaveCount(0);
  await statusPill(page).click();
  await expect(statusSheet(page)).toContainText("Everything on this map is arriving");
});

test("Poland's radar down is told over Poland: the notice, the pill and the sheet", async ({ page }) => {
  await serveStatus(page, radarDown("pl"));
  await openRadar(page, POLAND_VIEW);
  await expect(feedNotice(page)).toBeVisible();
  await expect(statusPill(page)).toHaveText("Out of date");
  await statusPill(page).click();
  const row = statusSheet(page).getByRole("listitem").filter({ hasText: "Radar, Poland" });
  await expect(row).toContainText("Nothing new since");
});

test("Poland's radar down says nothing over Bavaria", async ({ page }) => {
  await serveStatus(page, radarDown("pl"));
  await openRadar(page, BAVARIA_VIEW);
  await expect(statusPill(page)).toHaveText("Latest");
  await expect(feedNotice(page)).toBeHidden();
  await statusPill(page).click();
  await expect(statusSheet(page)).toContainText("Everything on this map is arriving");
  await expect(statusSheet(page)).not.toContainText("Poland");
});

/** The outage of 2026-11-12, as next reported it: every network's radar and forecast down, DWD's fine. */
function eumetnetDown(): Status {
  const status = recorded();
  status.components = status.components.map((component) => (component.kind === "radar" && component.domain !== "de"
    ? { ...component, state: "down", newest: NOW - 39_000, since: NOW - 36_000 }
    : component));
  for (const component of status.components.filter((c) => c.kind === "radar" && c.domain !== "de")) {
    status.components.push({ kind: "forecast", domain: component.domain, state: "down", newest: null });
  }
  return status;
}

for (const [where, view] of [
  ["all of Germany", "/?layer=radar&latLonZ=51.20000,10.40000,6.00"],
  ["Berlin, the Polish border in view", "/?layer=radar&latLonZ=52.50000,13.40000,7.00"],
  ["Saarbrücken, France in view", "/?layer=radar&latLonZ=49.23000,7.00000,8.00"],
]) {
  test(`with every network down, ${where} says nothing unasked and plays the forecast`, async ({ page }) => {
    await serveStatus(page, eumetnetDown());
    await openRadar(page, view);
    await expect(statusPill(page)).toHaveText("Latest");
    await expect(page.locator(".strip-dock")).toHaveCount(0);
    // The forecast is there to step into, with nothing said over it.
    await timeline(page).focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
    await expect(page.locator(".strip-dock")).toHaveCount(0);
    await expect(statusPill(page)).not.toHaveText(/Out of date|Delayed/);
  });
}

/** Every network's newest frame an hour old: the outage of 2026-11-12 as a backend without a status shows it. */
async function networksStale(page: Page): Promise<void> {
  await page.route("**/v3/status", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{\"detail\":\"Not Found\"}" }));
  await page.route(/\/v3\/radar\/(switzerland|france|czechia|poland|belgium|slovakia|lithuania|estonia|ireland|croatia|denmark|netherlands|finland|sweden|norway|europe)$/, (route) => {
    const answer = (JSON.parse(readFileSync(fixtureFile("GET", new URL(route.request().url())), "utf8")) as RecordedResponse).json as Record<string, number>;
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...answer, upstream_time: answer.upstream_time - 3600, processed_time: answer.processed_time - 3600 }),
    });
  });
}

for (const [where, view] of [
  ["all of Germany", "/?layer=radar&latLonZ=51.20000,10.40000,6.00"],
  ["Berlin, the Polish border in view", "/?layer=radar&latLonZ=52.50000,13.40000,7.00"],
  ["Saarbrücken, France in view", "/?layer=radar&latLonZ=49.23000,7.00000,8.00"],
]) {
  test(`without a status and every network stopped, ${where} says nothing unasked`, async ({ page }) => {
    await networksStale(page);
    await openRadar(page, view);
    await expect(statusPill(page)).toHaveText("Latest");
    await expect(page.locator(".strip-dock")).toHaveCount(0);
    await timeline(page).focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
    await expect(page.locator(".strip-dock")).toHaveCount(0);
  });
}

test("without a status and every network stopped, Poland is told", async ({ page }) => {
  await networksStale(page);
  await openRadar(page, POLAND_VIEW);
  await expect(feedNotice(page)).toBeVisible();
});

test("DWD's radar down with every network ok is told over Germany", async ({ page }) => {
  // Measured against DWD's own scan, the map's own rule can never blame DWD.
  await serveStatus(page, radarDown("de"));
  await openRadar(page, GERMANY_VIEW);
  await expect(feedNotice(page)).toBeVisible();
  await expect(statusPill(page)).toHaveText("Out of date");
  await statusPill(page).click();
  await expect(statusSheet(page).getByRole("listitem").filter({ hasText: "Radar, Germany" })).toBeVisible();
});

test("a warning of ours is shown first, dismissed for the session, and back after a reload", async ({ page }) => {
  const status = radarDown("de");
  status.notices = [{
    id: "2026-11-04-de", level: "warning", domains: ["de"], starts: NOW - 600, ends: null,
    text: { en: "DWD's radars are being serviced until 23:00 UTC.", de: "Die Radare des DWD werden gewartet." },
  }];
  await serveStatus(page, status);
  await openRadar(page, GERMANY_VIEW);
  await expect(warningNotice(page)).toBeVisible();
  await expect(page.getByText("DWD's radars are being serviced until 23:00 UTC.").first()).toBeVisible();
  // One at a time: the radar's notice waits behind it.
  await expect(feedNotice(page)).toBeHidden();

  await closeStrip(page).click();
  await expect(warningNotice(page)).toBeHidden();
  await expect(feedNotice(page)).toBeVisible();
  // The status asked again does not bring it back.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(feedNotice(page)).toBeVisible();
  await expect(warningNotice(page)).toBeHidden();

  await page.reload();
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
  await expect(warningNotice(page)).toBeVisible();
});

test("without a status, the map's own rule still finds a stopped network", async ({ page }) => {
  await page.route("**/v3/status", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{\"detail\":\"Not Found\"}" }));
  // Poland's newest frame an hour behind DWD's: today's rule (lib/feedOutage.ts) says stopped.
  await page.route("**/v3/radar/poland", (route) => {
    const answer = (JSON.parse(readFileSync(fixtureFile("GET", new URL(route.request().url())), "utf8")) as RecordedResponse).json as Record<string, number>;
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...answer, upstream_time: answer.upstream_time - 3600, processed_time: answer.processed_time - 3600 }),
    });
  });
  await openRadar(page, POLAND_VIEW);
  await expect(feedNotice(page)).toBeVisible();
  // Nothing judged by a status: no rows, no "everything is arriving".
  await statusPill(page).click();
  await expect(statusSheet(page)).not.toContainText("Everything on this map is arriving");
  await expect(statusSheet(page).getByRole("listitem")).toHaveCount(0);
});

test("without a status, a live map says Latest and nothing else", async ({ page }) => {
  await page.route("**/v3/status", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{\"detail\":\"Not Found\"}" }));
  await openRadar(page, GERMANY_VIEW);
  await expect(statusPill(page)).toHaveText("Latest");
  await expect(page.locator(".strip-dock")).toHaveCount(0);
});

test("a cut socket is in the sheet after 30 seconds, and the timeline is asked for within a minute", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  let asked = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v3/radar/timeseries") asked += 1;
  });
  await cutSocket(page);
  // Jumped rather than run: every timer of a minute's map is too much for a
  // phone's WebKit with all the workers going.
  await page.clock.fastForward(31_000);
  await statusPill(page).click();
  await expect(statusSheet(page)).toContainText("The live connection to meteocool is down");

  const before = asked;
  await page.clock.fastForward(61_000);
  await expect.poll(() => asked).toBeGreaterThan(before);
});

test("the sheet stops above the timeline and the tray", async ({ page }) => {
  // As much as a sheet can hold: every network down, and a long notice.
  const status = recorded();
  status.components = status.components.map((component) => ({ ...component, state: "down", since: NOW - 1800 }));
  status.notices = [{
    id: "long", level: "info", domains: null, starts: NOW - 600, ends: null,
    text: { en: "A notice long enough to wrap over several lines on a phone. ".repeat(12) },
  }];
  await serveStatus(page, status);
  await openRadar(page, GERMANY_VIEW);
  await statusPill(page).click();
  await expect(statusSheet(page)).toBeVisible();
  const sheet = (await statusSheet(page).boundingBox())!;
  const slider = (await timeline(page).boundingBox())!;
  const tray = (await page.locator(".bottomToolbar.timeslider").boundingBox())!;
  expect(overlaps(sheet, slider)).toBe(false);
  expect(overlaps(sheet, tray)).toBe(false);
  // The timeline is still there to take a hand.
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(statusSheet(page)).toBeVisible();
});

test("the sheet closes on Escape", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await statusPill(page).click();
  await expect(statusSheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(statusSheet(page)).toBeHidden();
});

test("Connection details opens the diagnostics from the sheet", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await statusPill(page).click();
  await statusSheet(page).getByRole("button", { name: "Connection Details" }).click();
  await expect(page.getByRole("dialog", { name: "Connection Details" })).toBeVisible();
});
