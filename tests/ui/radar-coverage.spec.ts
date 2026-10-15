import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar } from "./app";

/**
 * The "No Radar Here Yet" notice, which the player shows when the screen
 * misses every network's grid. Oradea, in Romania, is past the Czech and
 * Polish grids and in reach of only Slovakia's radars; Bucharest is in reach
 * of none.
 */
const ORADEA_VIEW = "/?layer=radar&latLonZ=47.07000,21.93000,10.00";
const BUCHAREST_VIEW = "/?layer=radar&latLonZ=44.43000,26.10000,10.00";

const noRadarNotice = (page: Page) => page.getByText("No Radar Here Yet");

test("where only Slovakia's radars reach, nothing says there is no radar", async ({ page }) => {
  await openRadar(page, ORADEA_VIEW);
  // Long enough for the notice to have come up if it were going to.
  await page.waitForTimeout(1000);
  await expect(noRadarNotice(page)).toBeHidden();
});

test("where no network reaches, the player says there is no radar", async ({ page }) => {
  await openRadar(page, BUCHAREST_VIEW);
  await expect(noRadarNotice(page)).toBeVisible();
});
