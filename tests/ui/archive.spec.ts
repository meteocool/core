import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { RADAR_VIEW, noGeocoder, openRadar, settled, timeline } from "./app";
import { COVERAGE, linkTime, serveArchive } from "./archive";

/**
 * A past window (lib/archive.ts): chosen in the player's Archive picker, or
 * named by a link, the timeline spans it in clock times, the pill at the top
 * says the date and is the way back to live, and the link carries it.
 *
 * The archive's routes are answered by tests/ui/archive.ts. The window is an
 * hour on the recording's evening: Wednesday 4 November, 20:00 to 21:00 in
 * Berlin, the tests' time zone, which is 19:00 to 20:00 UTC.
 */
const START = Date.UTC(2026, 10, 4, 19, 0) / 1000;
const END = START + 3600;
const WINDOW_LINK = `${RADAR_VIEW}&from=${linkTime(START)}&to=${linkTime(END)}`;

const archivePill = (page: Page) => page.getByRole("button", { name: "Archive", exact: true });
const archiveDialog = (page: Page) => page.getByRole("dialog", { name: "Archive" });
/** The cross on the frame's tab, in a past window: named by the date and time on screen, and the way back to live. */
const windowPill = (page: Page) => page.getByRole("button", { name: /back to live$/ });
/** The frame's tab itself, which opens the picker again. */
const windowTab = (page: Page) => page.locator(".archive-frame .choose");
const axisLabels = (page: Page) => page.locator(".timeline .axis .label").allTextContents();

/** Choose the hour from 20:00 on 4 November in the picker, and open it. */
async function chooseWindow(page: Page): Promise<void> {
  await archivePill(page).click();
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Day").selectOption({ label: "Wed 4 Nov" });
  await dialog.getByLabel("Start").selectOption({ label: "20:00" });
  await dialog.getByRole("radio", { name: "1 h" }).click();
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await noGeocoder(page);
});

test("the Archive pill opens the picker, with the days the archive keeps", async ({ page }) => {
  await serveArchive(page);
  await openRadar(page);
  await archivePill(page).click();
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  // Its first day to its last, both in part: 6 October to 5 November in Berlin.
  await expect(dialog.getByLabel("Day").locator("option")).toHaveCount(31);
  await expect(dialog.getByRole("button", { name: "Open" })).toBeEnabled();
});

test("the picker is reached and worked with the keyboard alone", async ({ page }) => {
  await serveArchive(page);
  await openRadar(page);
  await archivePill(page).focus();
  await page.keyboard.press("Enter");
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Open" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(timeline(page)).toHaveAttribute("aria-valuetext", /\d{1,2} \w{3} \d{2}:\d{2}/);
});

test("an empty archive says so, and opens nothing", async ({ page }) => {
  await serveArchive(page, { empty: true });
  await openRadar(page);
  await archivePill(page).click();
  const dialog = archiveDialog(page);
  await expect(dialog.getByText("The archive is empty")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Archive empty", exact: true })).toBeVisible();
});

test("a chosen window spans the timeline in clock times, and the pill says its date", async ({ page }) => {
  const asked = await serveArchive(page);
  await openRadar(page);
  await chooseWindow(page);

  await expect(timeline(page)).toHaveAttribute("aria-valuemax", "12");
  await expect(timeline(page)).toHaveAttribute("aria-valuenow", "12");
  await expect.poll(() => axisLabels(page)).toEqual(expect.arrayContaining(["20:00", "21:00"]));
  expect((await axisLabels(page)).every((label) => /^\d{2}:\d{2}$/.test(label.trim()))).toBe(true);
  await expect(windowPill(page)).toHaveAccessibleName(/Wed 4 Nov, 21:00/);

  const timeseries = asked.find((request) => request.path === "/v3/radar/timeseries");
  expect(timeseries?.query.get("start")).toBe(String(START));
  expect(timeseries?.query.get("end")).toBe(String(END));
  expect(timeseries?.query.has("lat")).toBe(false);
  expect(timeseries?.query.getAll("products")).not.toContain("nowcast");
});

test("the arrow keys move within the window, and stop at its ends", async ({ page }) => {
  await serveArchive(page);
  await openRadar(page);
  await chooseWindow(page);
  const strip = timeline(page);
  await expect(strip).toHaveAttribute("aria-valuenow", "12");

  await strip.focus();
  await page.keyboard.press("ArrowRight");
  await expect(strip).toHaveAttribute("aria-valuenow", "12");
  await page.keyboard.press("ArrowLeft");
  await expect(strip).toHaveAttribute("aria-valuenow", "11");
  await expect(windowPill(page)).toHaveAccessibleName(/Wed 4 Nov, 20:55/);
  for (let i = 0; i < 15; i += 1) await page.keyboard.press("ArrowLeft");
  await expect(strip).toHaveAttribute("aria-valuenow", "0");
  await expect(windowPill(page)).toHaveAccessibleName(/Wed 4 Nov, 20:00/);
});

test("the pill at the top returns to live", async ({ page }) => {
  await serveArchive(page);
  await openRadar(page);
  await chooseWindow(page);
  await expect(windowPill(page)).toBeVisible();

  await windowPill(page).click();
  await expect(page.locator(".live-wrapper")).toHaveText("Latest");
  await expect(windowPill(page)).toHaveCount(0);
  await expect.poll(() => axisLabels(page)).toContain("Now");
  await expect.poll(() => new URL(page.url()).searchParams.has("from")).toBe(false);
});

test("the frame's tab names the window, and opens the picker on it", async ({ page }, info) => {
  await serveArchive(page);
  await page.goto(WINDOW_LINK);
  await settled(timeline(page));
  const tab = windowTab(page);
  await expect(tab).toHaveAccessibleName("Archive, Wed 4 Nov, 21:00");
  // A desktop has the room for the window's day and span, then the step's clock.
  // The text as rendered: each layout's spans are in the page, one hidden.
  await expect.poll(() => tab.innerText()).toMatch(info.project.name === "desktop"
    ? /Archive\s*·\s*Wed 4 Nov, 20:00–21:00\s*·\s*21:00/
    : /Archive\s*·\s*Wed 4 Nov, 21:00/);

  await tab.click();
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Day")).toHaveValue(/.+/);
  await expect(dialog.getByLabel("Start").locator("option:checked")).toHaveText("20:00");
});

test("a from= and to= link opens in the window, and the share link carries it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => { (window as any).shared = data; },
    });
  });
  const asked = await serveArchive(page);
  await page.goto(WINDOW_LINK);
  await settled(timeline(page));

  await expect(timeline(page)).toHaveAttribute("aria-valuemax", "12");
  await expect(windowPill(page)).toHaveAccessibleName(/Wed 4 Nov, 21:00/);
  await expect.poll(() => asked.some((request) => request.path === "/storms"
    && request.query.get("until") === new Date(END * 1000).toISOString())).toBe(true);

  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => new URL(page.url()).searchParams.get("t")).toBe(linkTime(END - 300));

  await page.locator(".ol-share button").click();
  await expect.poll(() => page.evaluate(() => (window as any).shared?.url ?? null)).not.toBeNull();
  const shared = new URL(await page.evaluate(() => (window as any).shared.url as string));
  expect(shared.searchParams.get("from")).toBe(linkTime(START));
  expect(shared.searchParams.get("to")).toBe(linkTime(END));
  expect(shared.searchParams.get("t")).toBe(linkTime(END - 300));
});

test("a link to a frame older than the live timeline opens a window ending on it", async ({ page }) => {
  await serveArchive(page);
  await page.goto(`${RADAR_VIEW}&t=${linkTime(END)}`);
  await settled(timeline(page));
  await expect(windowPill(page)).toHaveAccessibleName(/Wed 4 Nov, 21:00/);
  // Two hours, ending on the frame.
  await expect(timeline(page)).toHaveAttribute("aria-valuemax", "24");
  await expect(timeline(page)).toHaveAttribute("aria-valuenow", "24");
  await expect.poll(() => new URL(page.url()).searchParams.get("from")).toBe(linkTime(END - 7200));
});

test("in a window the strikes come from the archive, for the step on screen", async ({ page }) => {
  const asked = await serveArchive(page);
  await openRadar(page);
  await chooseWindow(page);
  await expect.poll(() => asked.filter((request) => request.path === "/v3/lightning/strikes").length).toBeGreaterThan(0);
  const pieces = asked.filter((request) => request.path === "/v3/lightning/strikes");
  for (const piece of pieces) {
    const since = Number(piece.query.get("since"));
    const until = Number(piece.query.get("until"));
    expect(until - since).toBeLessThanOrEqual(3 * 3600);
    expect(until).toBeLessThanOrEqual(COVERAGE.until + 300);
  }
});

test("a window the backend refuses is left, back to live", async ({ page }) => {
  await serveArchive(page);
  await page.route(/\/v3\/radar\/timeseries\?.*start=/, (route) => route.fulfill({
    status: 422, contentType: "application/json", body: JSON.stringify({ detail: "Outside the archive" }),
  }));
  await page.goto(WINDOW_LINK);
  await settled(timeline(page));
  await expect(page.locator(".live-wrapper")).toHaveText("Latest");
  await expect.poll(() => new URL(page.url()).searchParams.has("from")).toBe(false);
});
