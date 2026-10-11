import { expect, test, type Page } from "@playwright/test";
import { openRadar, playButton, timeline } from "./app";

/**
 * Where the screen has radar but no forecast. The demo replays a storm over
 * Aquitaine, where Météo-France's radar draws the present and DWD's forecast,
 * the only one, does not reach.
 */
const AQUITAINE_VIEW = "/?layer=radar&latLonZ=44.80000,-0.60000,8.00";
/** Central Germany, close enough that the whole screen is inside DWD's reach on a desktop too. */
const GERMANY_VIEW = "/?layer=radar&latLonZ=50.50000,10.00000,8.00";

const noForecastNotice = (page: Page) => page.getByText("No Forecast Here");

const stepIndex = async (page: Page): Promise<number> => Number(await timeline(page).getAttribute("aria-valuenow"));

async function step(page: Page, key: "ArrowLeft" | "ArrowRight", times: number): Promise<void> {
  await timeline(page).focus();
  for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
}

test("with no forecast on screen, play is off on now", async ({ page }) => {
  await openRadar(page, AQUITAINE_VIEW);
  await expect(playButton(page)).toBeDisabled();
  await expect(noForecastNotice(page)).toBeHidden();
});

test("dragged into the forecast, the player says there is none here", async ({ page }) => {
  await openRadar(page, AQUITAINE_VIEW);
  await step(page, "ArrowRight", 3);
  await expect(noForecastNotice(page)).toBeVisible();
  await expect(playButton(page)).toBeDisabled();
});

test("from the past, play loops the past radar and never enters the forecast", async ({ page }) => {
  await openRadar(page, AQUITAINE_VIEW);
  const now = await stepIndex(page);
  await step(page, "ArrowLeft", 3);
  await expect(playButton(page)).toBeEnabled();
  await playButton(page).click();
  await expect(playButton(page)).toHaveClass(/playing/);

  // Three frames up to now, 450 ms apart, then back: four seconds see a wrap.
  const seen: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    seen.push(await stepIndex(page));
    await page.waitForTimeout(160);
  }
  expect(Math.max(...seen)).toBeLessThanOrEqual(now);
  expect(seen.some((index, i) => i > 0 && index < seen[i - 1])).toBe(true);
  await expect(noForecastNotice(page)).toBeHidden();
});

test("over the forecast, play stays on into it and nothing is said", async ({ page }) => {
  await openRadar(page, GERMANY_VIEW);
  await step(page, "ArrowRight", 3);
  await expect(playButton(page)).toBeEnabled();
  await expect(noForecastNotice(page)).toBeHidden();
});
