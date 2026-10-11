import { expect, type Locator, type Page } from "@playwright/test";

/** Central Germany, where the demo storm's radar is: the radar map, at a country's zoom. */
export const RADAR_VIEW = "/?layer=radar&latLonZ=50.50000,9.50000,6.00";

/** Open the radar map and wait for the player, which opens by itself on it. */
export async function openRadar(page: Page, path = RADAR_VIEW): Promise<void> {
  await page.goto(path);
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
}

export const timeline = (page: Page): Locator => page.getByRole("slider", { name: "Radar timeline" });

/** The radar product control: a pill on a phone, the legend's caption on a desktop. */
export const productControl = (page: Page): Locator =>
  page.locator("button[aria-haspopup='menu'][title='Choose the radar product']:visible").first();

export const productMenu = (page: Page): Locator => page.getByRole("menu", { name: "Radar Product" });

export const backToNow = (page: Page): Locator => page.getByRole("button", { name: "Back to now" });

export const playButton = (page: Page): Locator => page.locator("button.controlButton.play");

/** Whether two boxes overlap, by more than a hairline. */
export function overlaps(a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}
