import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { RADAR_VIEW, noGeocoder, openRadar, productControl, settled, timeline } from "./app";
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

/** A day on the picker's calendar, by its full date. */
const calendarDay = (dialog: Locator, name: string) => dialog.getByRole("button", { name, exact: true });
/** One of the picker's wheels, named by what it picks: "Start, Hour", "Start, Minute", "Length". */
const wheel = (dialog: Locator, name: string) => dialog.getByRole("spinbutton", { name, exact: true });

/** Turn a wheel to `label` from the keyboard: to its top, then a notch at a time, 34px each. */
async function turnWheel(dialog: Locator, name: string, label: string): Promise<void> {
  const control = wheel(dialog, name);
  const labels = await control.locator(".row").allTextContents();
  const notches = labels.map((text) => text.trim()).indexOf(label);
  expect(notches, `${label} on the ${name} wheel`).toBeGreaterThanOrEqual(0);
  await control.focus();
  await control.press("Home");
  for (let i = 0; i < notches; i += 1) await control.press("ArrowDown");
  await expect(control).toHaveAttribute("aria-valuetext", label);
  // And at rest on it: a hand on a wheel still turning would race its motion.
  await expect.poll(() => control.locator(".scroller").evaluate((el, top) => Math.abs(el.scrollTop - top) <= 1, notches * 34))
    .toBe(true);
}

/** Choose the hour from 20:00 on 4 November in the picker, and open it. */
async function chooseWindow(page: Page): Promise<void> {
  await archivePill(page).click();
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  await calendarDay(dialog, "Wednesday 4 November 2026").click();
  await turnWheel(dialog, "Start, Hour", "20");
  await turnWheel(dialog, "Start, Minute", "00");
  await turnWheel(dialog, "Length", "1 h");
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
  const kept = dialog.getByRole("group", { name: "Day" }).locator("button:enabled");
  await expect(kept).toHaveCount(5);
  await expect(dialog.getByRole("button", { name: "Next month" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Previous month" }).click();
  await expect(kept).toHaveCount(26);
  await expect(dialog.getByRole("button", { name: "Previous month" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Open" })).toBeEnabled();
});

test("the picker's wheels turn with a scroll or a tap, its calendar with the arrow keys", async ({ page }, info) => {
  await serveArchive(page);
  await openRadar(page);
  await archivePill(page).click();
  const dialog = archiveDialog(page);
  await calendarDay(dialog, "Wednesday 4 November 2026").click();
  await turnWheel(dialog, "Start, Hour", "20");
  await turnWheel(dialog, "Start, Minute", "00");
  const hour = wheel(dialog, "Start, Hour");

  // A scroll of two rows settles two hours on; mobile WebKit has no wheel.
  if (info.project.name === "desktop") {
    await hour.hover();
    await page.mouse.wheel(0, 68);
    await expect(hour).toHaveAttribute("aria-valuetext", "22");
  } else {
    await turnWheel(dialog, "Start, Hour", "22");
  }
  // A row in sight above or below the band comes to it.
  const below = hour.locator(".row", { hasText: /^\s*23\s*$/ });
  if (info.project.name === "desktop") await below.click();
  else await below.tap();
  await expect(hour).toHaveAttribute("aria-valuetext", "23");
  await expect(dialog.locator(".summary")).toContainText("Wed 4 Nov, 23:00");

  const day = calendarDay(dialog, "Wednesday 4 November 2026");
  await day.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(calendarDay(dialog, "Tuesday 3 November 2026")).toHaveAttribute("aria-pressed", "true");
  await expect(calendarDay(dialog, "Tuesday 3 November 2026")).toBeFocused();
  await expect(dialog.locator(".summary")).toContainText("Tue 3 Nov, 23:00");
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
  // A desktop has the room for the window's day and span, then the step's
  // clock; a phone's tab, between its buttons, the step's date and time alone.
  // The text as rendered: each layout's spans are in the page, the others hidden.
  await expect.poll(() => tab.innerText()).toMatch(info.project.name === "desktop"
    ? /Archive\s*·\s*Wed 4 Nov, 20:00–21:00\s*·\s*21:00/
    : /^\s*4 Nov, 21:00\s*$/);
  // The top line stays on the top edge, beside the tab, where it fits.
  const logoTop = () => page.locator(".top-left").evaluate((el) => el.getBoundingClientRect().top);
  await expect.poll(logoTop).toBeLessThan(20);
  await page.setViewportSize({ width: 340, height: 700 });
  // Too narrow for both: the line moves below the tab.
  await expect.poll(logoTop).toBeGreaterThan(26);
  await page.setViewportSize(info.project.use.viewport ?? { width: 393, height: 659 });

  await tab.click();
  const dialog = archiveDialog(page);
  await expect(dialog).toBeVisible();
  await expect(calendarDay(dialog, "Wednesday 4 November 2026")).toHaveAttribute("aria-pressed", "true");
  await expect(wheel(dialog, "Start, Hour")).toHaveAttribute("aria-valuetext", "20");
  await expect(wheel(dialog, "Start, Minute")).toHaveAttribute("aria-valuetext", "00");
  await expect(wheel(dialog, "Length")).toHaveAttribute("aria-valuetext", "1 h");
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

test("in a window the product control names the product without a live age", async ({ page }) => {
  await serveArchive(page);
  await openRadar(page);
  await expect(productControl(page)).toContainText(/min ago/);
  await chooseWindow(page);
  await expect(productControl(page)).toBeVisible();
  await expect(productControl(page)).not.toContainText(/min ago/);
  await expect(productControl(page)).not.toContainText(/unavailable/);
});

test("in a window the overlays with no past are greyed in Settings, and back with live", async ({ page }) => {
  await serveArchive(page);
  await page.goto(WINDOW_LINK);
  await settled(timeline(page));
  await page.getByRole("button", { name: "Settings" }).click();
  for (const name of [/^Radar Sites/, /^Rain Motion/]) {
    await expect(page.getByRole("switch", { name })).toBeDisabled();
  }
  for (const name of [/^Live Lightning/, /^Storm Cells/]) {
    await expect(page.getByRole("switch", { name })).toBeEnabled();
  }
  await expect(page.getByText("Not kept in the archive").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await windowPill(page).click();
  await expect(page.locator(".live-wrapper")).toHaveText("Latest");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: /^Radar Sites/ })).toBeEnabled();
  await expect(page.getByText("Not kept in the archive")).toHaveCount(0);
});
