import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES, type RecordedResponse } from "./offline";
import { expect, test } from "./test";

/**
 * A linked storm's "Inside" cutaway, across the map's refreshes.
 *
 * The viewport's answer never carries a cell's radar volume; the answer for
 * one cell does. A link fetches the latter, finds the storm the cell belongs
 * to (whose detail carries the cell without one) and then refreshes the
 * map, whose copy of the same storm has none either, and either copy used to
 * replace the panel's, cutaway and all.
 *
 * A recording seldom has a storm with a volume, so the link's answer is put
 * together from what is recorded: a cell of the viewport's answer, given the
 * first recorded volume. Its tiles are blank, so the cutaway says it cannot
 * show the storm; the section it sits in is what this is about.
 */
const recorded = (name: string) => (JSON.parse(
  readFileSync(path.join(FIXTURES, "api", `${name}.json`), "utf8"),
) as RecordedResponse).json as Record<string, any>;

const tracks = recorded("GET_cells_tracks");
const cell = tracks.features.find((track: any) => track.properties.active && !track.properties.child_codes.length
  && !track.properties.parent_codes.length);
const linked = { ...cell, properties: { ...cell.properties, volume: recorded("GET_cells_volumes").volumes[0] } };

const inside = (page: Page) => page.getByRole("heading", { name: /^Inside/ });

/** How many viewport answers have come in since the link's own. */
function countViewportAnswers(page: Page): () => number {
  let linkAnswered = false;
  let answers = 0;
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === `/cells/tracks/${cell.properties.code}`) linkAnswered = true;
    else if (linkAnswered && url.pathname === "/storms" && url.searchParams.has("bbox")) answers += 1;
  });
  return () => answers;
}

/** Long enough for an answer that has come in to have been drawn and handed to the panel. */
const drawn = (page: Page) => page.waitForTimeout(1000);

test("a linked storm's cutaway stays when the map refreshes its storms", async ({ page }) => {
  await page.route(`**/cells/tracks/${cell.properties.code}`, (route) => route.fulfill({ json: linked }));
  const viewportAnswers = countViewportAnswers(page);

  await page.goto(`/?layer=radar&cell=${cell.properties.code}`);
  await expect(inside(page)).toBeVisible({ timeout: 30_000 });

  // The refresh the link asks for itself, once the cell is open.
  await expect.poll(viewportAnswers).toBeGreaterThan(0);
  await drawn(page);
  await expect(inside(page)).toBeVisible();

  // And the one an app coming back to the foreground asks for.
  const before = viewportAnswers();
  await page.evaluate(() => window.enterForeground?.());
  await expect.poll(viewportAnswers).toBeGreaterThan(before);
  await drawn(page);
  await expect(inside(page)).toBeVisible();
});
