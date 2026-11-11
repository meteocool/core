import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { openRadar, timeline } from "./app";

/**
 * A frame the timeline moves to is shown at once from its coarse preview
 * (lib/previewTiles.ts), a few zooms up, and sharpened as its own tiles come:
 * the map never waits on those to show the time the needle is on.
 */

/** The radar's tiles at the zoom the test's view is drawn from. */
const AT_VIEW_ZOOM = /^\/tiles\/(meteoradar|meteonowcast)\/[^/]+\/5\/\d+\/\d+\.png$/;

/**
 * What the radar's frame layer is showing: how many sources are still on
 * another frame than the timeline's, whether every tile is in, and how many
 * frames were shown from a preview. Null where tile layers draw the radar.
 */
function frames(page: Page): Promise<{ behind: number; complete: boolean; previewed: number } | null> {
  return page.evaluate(() => {
    const layer = (window as any).lm.getCurrentMap().getAllLayers().find((candidate: any) => candidate.slots);
    return layer ? { behind: layer.behind, complete: layer.getRenderer().ready, previewed: layer.stats.previewSwitches } : null;
  });
}

test("a step back is shown from its preview while its own tiles are still on their way", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let holding = false;
  await page.route((url) => AT_VIEW_ZOOM.test(url.pathname), async (route) => {
    if (holding) await held;
    await route.fallback();
  });
  await openRadar(page);
  test.skip(await frames(page) === null, "the radar is drawn by tile layers here");
  await expect.poll(async () => (await frames(page))!.complete, { timeout: 20_000 }).toBe(true);

  holding = true;
  await timeline(page).focus();
  await page.keyboard.press("ArrowLeft");
  try {
    // The frame stepped to is on screen, every source of it, with none of its own tiles in.
    await expect.poll(async () => (await frames(page))!.previewed, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await frames(page))!.behind).toBe(0);
    expect((await frames(page))!.complete).toBe(false);
  } finally {
    release();
  }
  // Its tiles replace the preview.
  await expect.poll(async () => (await frames(page))!.complete, { timeout: 20_000 }).toBe(true);
});

/** The nowcasts' tiles, at any zoom: previews of them included. */
const NOWCAST_TILE = /^\/tiles\/meteonowcast\//;

/** How many hidden sources are still drawn, and how many shown ones (in view or not) still draw nothing. */
function changingPlaces(page: Page): Promise<{ lingering: number; waiting: number }> {
  return page.evaluate(() => {
    const layer = (window as any).lm.getCurrentMap().getAllLayers().find((candidate: any) => candidate.slots);
    return {
      lingering: layer.slots.filter((slot: any) => slot.lingering).length,
      waiting: layer.slots.filter((slot: any) => slot.visible && slot.frames.waiting).length,
    };
  });
}

test("stepping into the forecast, the networks' observations stay until their nowcasts can be drawn", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => NOWCAST_TILE.test(url.pathname), async (route) => {
    await held;
    await route.fallback();
  });
  await openRadar(page);
  test.skip(await frames(page) === null, "the radar is drawn by tile layers here");
  await expect.poll(async () => (await frames(page))!.complete, { timeout: 20_000 }).toBe(true);

  await timeline(page).focus();
  await page.keyboard.press("ArrowRight");
  try {
    // The nowcasts have nothing to draw yet: what they replace is still on the map.
    await expect.poll(async () => (await changingPlaces(page)).lingering).toBeGreaterThan(0);
    expect((await changingPlaces(page)).waiting).toBeGreaterThan(0);
    expect((await frames(page))!.complete).toBe(false);
  } finally {
    release();
  }
  // Once they can be, the two change places in one draw.
  await expect.poll(async () => (await changingPlaces(page)).lingering, { timeout: 20_000 }).toBe(0);
  expect((await frames(page))!.behind).toBe(0);
  await expect.poll(async () => (await frames(page))!.complete, { timeout: 20_000 }).toBe(true);
});
