import { expect, test } from "./test";
import { openRadar } from "./app";

/** Settings, opened from the gear beside the logo. */

test.beforeEach(async ({ page }) => {
  await openRadar(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Playback" })).toBeVisible();
});

test("the Playback section's loop switch is off, and remembered when turned on", async ({ page }) => {
  const loop = page.getByRole("switch", { name: "Loop From Two Hours Back" });
  await expect(loop).not.toBeChecked();
  await loop.check();
  await expect(loop).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("playbackFromStart"))).toBe("true");

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "Loop From Two Hours Back" })).toBeChecked();
});

test("the player has no -2h button of its own any more", async ({ page }) => {
  await expect(page.getByRole("button", { name: /two hours back/i })).toHaveCount(0);
});

test("About's text can be selected, and the map still cannot", async ({ page }) => {
  await page.getByRole("button", { name: "About meteocool" }).click();
  const about = page.getByRole("dialog", { name: "About meteocool" });
  const paragraph = about.locator("p").first();
  await expect(paragraph).toBeVisible();
  const selectable = (el: Element) => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect;
  expect(await paragraph.evaluate(selectable)).toBe("text");
  expect(await about.getByRole("heading", { name: "About meteocool" }).evaluate(selectable)).toBe("text");
  expect(await page.locator(".ol-viewport, .maplibre-host").first().evaluate(selectable)).toBe("none");
});

test("a selection dragged out of the panel leaves it open; a tap beside it closes it", async ({ page, isMobile }) => {
  test.skip(isMobile, "a phone's panel is a full-height sheet with nothing beside it");
  await page.getByRole("button", { name: "About meteocool" }).click();
  const about = page.getByRole("dialog", { name: "About meteocool" });
  const box = (await about.locator("p").first().boundingBox())!;
  const panel = (await about.boundingBox())!;
  const outside = { x: panel.x + panel.width + 40, y: box.y + box.height / 2 };

  // On the first line's text: a press in the gap between words or lines
  // only places a caret, and the drag then selects nothing.
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(outside.x, outside.y, { steps: 8 });
  await page.mouse.up();
  await expect(about).toBeVisible();
  expect(await page.evaluate(() => String(getSelection()))).toContain("brought to you by");

  await page.mouse.click(outside.x, outside.y);
  await expect(about).toBeHidden();
});

test("Settings' rows are controls, not text to select", async ({ page }) => {
  const row = page.getByRole("button", { name: "About meteocool" });
  expect(await row.evaluate((el) => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect)).toBe("none");
});
