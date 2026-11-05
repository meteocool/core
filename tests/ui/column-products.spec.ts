import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, productControl, productMenu, timeline } from "./app";
import { fixtureFile } from "./offline";

/**
 * The echo tops and VIL: picked in the radar menu, each drawn whole with a
 * legend in its own unit, and reflectivity's legend again on a step it does
 * not draw. The recording has none of their frames, so each is answered
 * with the recorded column maximum's frame in its encoding: the same pass,
 * the same grid and stamp.
 */

async function columnFrames(page: Page): Promise<void> {
  const colmax = JSON.parse(readFileSync(fixtureFile("GET", new URL("http://localhost/v3/radar/colmax")), "utf8")).json;
  for (const [route, encoding] of [["echotop18", "height-250m-u8"], ["vil", "vil-0.5kg-u8"]]) {
    await page.route(`**/v3/radar/${route}`, (answer) => answer.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...colmax, values: { ...colmax.values, encoding } },
    }));
  }
}

async function choose(page: Page, name: RegExp): Promise<void> {
  await productControl(page).click();
  await productMenu(page).getByRole("menuitemradio", { name }).click();
  await expect(productMenu(page)).toBeHidden();
}

const unit = (page: Page) => page.locator(".legend .scale-unit");
/** Reflectivity's strip, the one legend that switches between pictograms and dBZ. */
const dbzLegend = (page: Page) => page.locator(".legend button.scale");

test.beforeEach(async ({ page }) => {
  await columnFrames(page);
  await openRadar(page);
});

test("the menu lists the echo tops and VIL under their own heading", async ({ page }) => {
  await productControl(page).click();
  const group = productMenu(page).getByRole("group", { name: "Echo Tops & VIL" });
  await expect(group.getByRole("menuitemradio")).toHaveCount(4);
  await expect(group.getByRole("menuitemradio").first()).toContainText("18 dBZ top");
  await expect(group.getByRole("menuitemradio").last()).toContainText("VIL");
});

test("an echo top's legend is in km, VIL's in kg/m², and a forecast step is read in dBZ again", async ({ page }) => {
  await expect(dbzLegend(page)).toBeVisible();
  await choose(page, /18 dBZ top/);
  await expect(unit(page)).toHaveText("km");
  await expect(dbzLegend(page)).toHaveCount(0);

  // The forecast is WN's whatever is chosen.
  await timeline(page).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await expect(dbzLegend(page)).toBeVisible();
  await expect(unit(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(unit(page)).toHaveText("km");

  await choose(page, /VIL/);
  await expect(unit(page)).toHaveText("kg/m²");
});
