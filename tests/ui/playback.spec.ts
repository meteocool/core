import { expect, test } from "./test";
import type { Page } from "@playwright/test";
import { backToNow, openRadar, playButton, timeline } from "./app";

/** The player: its timeline, playback, and the way back to now. */

test.beforeEach(async ({ page }) => {
  await openRadar(page);
});

/** Where the dashed now line is drawn and where the needle stands, in the strip's own pixels. */
async function lineAndNeedle(page: Page): Promise<{ line: number; needle: number }> {
  return timeline(page).evaluate((strip) => {
    const line = Number(strip.querySelector("line.now")?.getAttribute("x1"));
    const transform = (strip.querySelector(".needle-group") as SVGGElement | null)?.style.transform ?? "";
    return { line, needle: Number(/translateX\(([-\d.]+)px\)/.exec(transform)?.[1]) };
  });
}

test("the dashed now line is where the needle rests on now", async ({ page }) => {
  const { line, needle } = await lineAndNeedle(page);
  expect(Number.isFinite(line) && Number.isFinite(needle)).toBe(true);
  expect(Math.abs(line - needle)).toBeLessThan(0.5);
});

test("Back to now is hidden on the live frame", async ({ page }) => {
  await expect(backToNow(page)).toBeHidden();
});

test("a background radar refresh keeps Latest and Back to now stable", async ({ page }) => {
  const indicator = page.locator(".live-wrapper");
  await expect(indicator).toHaveText("Latest");
  const shown = await timeline(page).getAttribute("aria-valuenow");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/v3/radar/timeseries**", async (route) => {
    await pending;
    await route.fallback();
  });
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/v3/radar/timeseries");
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/v3/radar/timeseries");
  await page.evaluate(() => (window.lm.getCapability("radar") as import("../../src/caps/RadarCapability").default).reloadRadar());
  await requested;
  try {
    // Keep the request open long enough for the pill and its transition to appear.
    await page.waitForTimeout(400);
    await expect(indicator).toHaveText("Latest", { timeout: 100 });
    await expect(backToNow(page)).toBeHidden();
    await expect(timeline(page)).toHaveAttribute("aria-valuenow", shown!);
  } finally {
    release();
  }
  await answered;
  await expect(indicator).toHaveText("Latest");
  await expect(backToNow(page)).toBeHidden();
  await expect(timeline(page)).toHaveAttribute("aria-valuenow", shown!);
});

test("Back to now shows through playback and stops it on the live frame", async ({ page }) => {
  await playButton(page).click();
  await expect(playButton(page)).toHaveClass(/playing/);
  await expect(backToNow(page)).toBeVisible();
  // Frame after frame, 450 ms apart, not only on the first.
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(450);
    await expect(backToNow(page)).toBeVisible({ timeout: 100 });
  }
  await backToNow(page).click();
  await expect(playButton(page)).not.toHaveClass(/playing/);
  await expect(backToNow(page)).toBeHidden();
});

test("Back to now goes while a hand is on the timeline, and comes back on release", async ({ page }) => {
  await expect(timeline(page)).toHaveAttribute("aria-readonly", "false");
  const live = await timeline(page).getAttribute("aria-valuetext");
  const box = (await timeline(page).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
  await expect(timeline(page)).not.toHaveAttribute("aria-valuetext", live!);
  await expect(backToNow(page)).toBeHidden();
  // Held still before letting go: "here", not a flick that glides on.
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(timeline(page)).not.toHaveAttribute("aria-valuetext", live!);
  await expect(backToNow(page)).toBeVisible();
  await backToNow(page).click();
  await expect(backToNow(page)).toBeHidden();
});

test("a quick drag with the mouse stops where it is let go, with no glide after", async ({ page }) => {
  // Driven in the page, a few milliseconds a move, and let go at once: a
  // drag from here is too slow between moves, and reads as a hand held still.
  const atRelease = await timeline(page).evaluate(async (strip) => {
    const rect = strip.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const fire = (type: string, share: number) => strip.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 7, pointerType: "mouse", isPrimary: true, clientX: rect.left + rect.width * share, clientY: y,
    }));
    fire("pointerdown", 0.5);
    for (let share = 0.47; share >= 0.2; share -= 0.03) {
      await new Promise((resolve) => setTimeout(resolve, 8));
      fire("pointermove", share);
    }
    const now = strip.getAttribute("aria-valuenow");
    fire("pointerup", 0.2);
    return now;
  });
  await page.waitForTimeout(1000);
  // Settled onto the whole step nearest the release, which may be the next
  // one over; a glide would have carried it well on, towards -2h.
  const settled = Number(await timeline(page).getAttribute("aria-valuenow"));
  expect(Math.abs(settled - Number(atRelease))).toBeLessThanOrEqual(1);
});
