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
