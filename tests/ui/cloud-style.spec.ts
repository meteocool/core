import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { open3d, overlaps } from "./app";

/**
 * How the 3D map draws its storms, picked in the peel's tray: the pill names
 * the style on the map, the menu changes it, and the choice is the reader's
 * from then on. A link names the sender's without making it the receiver's.
 */
/* Straight down and close in: a tilted view of half a country is a long first frame without a GPU. */
const MAP_3D = "/?layer=cells3d&latLonZ=50.50000,9.50000,10.00&pitch=0&bearing=0";

const stylePill = (page: Page) => page.getByRole("button", { name: /^Storm style: / });
const styleMenu = (page: Page) => page.getByRole("menu", { name: "Storm Style" });
const peel = (page: Page) => page.getByRole("slider", { name: "Peel the storms down to their cores" });
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("layer3dStyle"));

/**
 * The 3D map with its tray up. The tray waits for the map's first settled
 * frame, well after its canvas: past 45 s for the whole test on a loaded
 * machine, where a desktop Chromium draws the map without a GPU.
 */
async function openTray(page: Page, path: string): Promise<void> {
  test.slow();
  await open3d(page, path);
  await expect(stylePill(page)).toBeVisible({ timeout: 60_000 });
}

test("the tray's pill picks the style, which is kept and written into the link", async ({ page }) => {
  await openTray(page, MAP_3D);
  await expect(stylePill(page)).toHaveAccessibleName("Storm style: Cloud");

  await stylePill(page).click();
  const options = styleMenu(page).getByRole("menuitemradio");
  await expect(options).toHaveCount(3);
  await expect(options.filter({ hasText: "Cloud" })).toHaveAttribute("aria-checked", "true");
  await options.filter({ hasText: "Shells" }).click();

  await expect(styleMenu(page)).toBeHidden();
  await expect(stylePill(page)).toHaveAccessibleName("Storm style: Shells");
  await expect(page).toHaveURL(/[?&]style=shells(&|$)/);
  expect(await stored(page)).toBe("shells");

  // The reader's own from here on: a visit without a link opens in it.
  await openTray(page, MAP_3D);
  await expect(stylePill(page)).toHaveAccessibleName("Storm style: Shells");
});

test("a link's style is shown without becoming the reader's own", async ({ page }) => {
  await openTray(page, `${MAP_3D}&style=glow`);
  await expect(stylePill(page)).toHaveAccessibleName("Storm style: Glow");
  expect(await stored(page)).toBeNull();
});

test("the style's pill stands in the tray beside the slider, neither over the other", async ({ page }) => {
  await openTray(page, MAP_3D);
  const [pill, slider] = await Promise.all([stylePill(page).boundingBox(), peel(page).boundingBox()]);
  expect(pill).not.toBeNull();
  expect(slider).not.toBeNull();
  expect(overlaps(pill!, slider!)).toBe(false);
  // Still a slider on a phone's width, with two pills at its end.
  expect(slider!.width).toBeGreaterThan(100);
});

test("Escape closes the style's menu and leaves the style as it was", async ({ page }) => {
  await openTray(page, MAP_3D);
  await stylePill(page).click();
  await expect(styleMenu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(styleMenu(page)).toBeHidden();
  await expect(stylePill(page)).toHaveAccessibleName("Storm style: Cloud");
});
