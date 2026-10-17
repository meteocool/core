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

/** Dublin and Tromsø: past every grid but Ireland's and Norway's, which joined in the second wave. */
const DUBLIN_VIEW = "/?layer=radar&latLonZ=53.35000,-6.26000,10.00";
const TROMSO_VIEW = "/?layer=radar&latLonZ=69.65000,18.96000,10.00";

test("over Ireland and northern Norway, nothing says there is no radar", async ({ page }) => {
  for (const view of [DUBLIN_VIEW, TROMSO_VIEW]) {
    await openRadar(page, view);
    // Long enough for the notice to have come up if it were going to.
    await page.waitForTimeout(1000);
    await expect(noRadarNotice(page)).toBeHidden();
  }
});

test("where no network reaches, the player says there is no radar", async ({ page }) => {
  await openRadar(page, BUCHAREST_VIEW);
  await expect(noRadarNotice(page)).toBeVisible();
});
