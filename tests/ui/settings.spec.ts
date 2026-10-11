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
