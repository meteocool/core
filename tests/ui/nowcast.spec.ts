import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, playButton, timeline } from "./app";
import { fixtureFile, type RecordedResponse } from "./offline";

/**
 * meteocool's own nowcast outside Germany, behind the experimental setting
 * (lib/nowcast.ts). The recording has no run in it, so the timeseries is
 * answered here with a French one put in: an hour of leads from the first
 * forecast step, shaped as WN's steps are, as the API sends it with
 * `products=nowcast`.
 */
const AQUITAINE_VIEW = "/?layer=radar&latLonZ=44.80000,-0.60000,8.00";
const RUN_LEADS = 12;

const noForecastNotice = (page: Page) => page.getByText("No Forecast Here");

async function step(page: Page, times: number): Promise<void> {
  await timeline(page).focus();
  for (let i = 0; i < times; i += 1) await page.keyboard.press("ArrowRight");
}

/** Answer the timeseries with a French run whenever it is asked for; returns each request's `products`. */
async function answerWithRun(page: Page): Promise<string[][]> {
  const asked: string[][] = [];
  await page.route("**/v3/radar/timeseries*", (route) => {
    const url = new URL(route.request().url());
    const products = url.searchParams.getAll("products");
    asked.push(products);
    const recorded = JSON.parse(readFileSync(fixtureFile("GET", url), "utf8")) as RecordedResponse;
    const answer = structuredClone(recorded.json) as {
      frames: Record<string, { source: string; tile_id: string } | null>;
      products?: Record<string, unknown>;
    };
    if (products.includes("nowcast")) {
      const forecast = Object.keys(answer.frames)
        .filter((key) => answer.frames[key]?.source === "nowcast_phys")
        .sort()
        .slice(0, RUN_LEADS);
      answer.products = {
        ...answer.products,
        nowcast_fr: Object.fromEntries(forecast.map((key, i) => [key, {
          ...answer.frames[key], tile_id: `nowcast-fr-${i}`, source: "nowcast_phys",
        }])),
      };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });
  return asked;
}

test("off by default: the nowcast is not asked for, and France has no forecast", async ({ page }) => {
  const asked = await answerWithRun(page);
  await openRadar(page, AQUITAINE_VIEW);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((products) => !products.includes("nowcast"))).toBe(true);
  await step(page, 3);
  await expect(noForecastNotice(page)).toBeVisible();
  await expect(page.getByText("DE only")).toHaveCount(0);
});

test("turned on, it is asked for, remembered, and France has a forecast to its last lead", async ({ page }) => {
  const asked = await answerWithRun(page);
  await openRadar(page, AQUITAINE_VIEW);
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "meteocool Nowcast (Experimental)" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(() => localStorage.getItem("meteocoolNowcast"))).toBe("true");
  await expect.poll(() => asked.some((products) => products.includes("nowcast"))).toBe(true);
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
  // The forecast past the run's last lead is Germany's alone, and marked so.
  await expect(page.getByText("DE only")).toBeVisible();
  await step(page, 3);
  await expect(noForecastNotice(page)).toBeHidden();
  await expect(playButton(page)).toBeEnabled();
  // Past the run, France is back to having none.
  await step(page, RUN_LEADS);
  await expect(noForecastNotice(page)).toBeVisible();
});
