import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { open3d } from "./app";

/**
 * The 3D map's boxes on the ground, greyed for a storm a scan behind the
 * radar draped under it, as the flat map's "3D" tag is. The recording is one
 * such moment: DWD's newest frame is 01:35 and Germany's volumes are still
 * 01:30's, while France's and Switzerland's are their radar's own scan.
 */
const BORDER_3D = "/?layer=cells3d&latLonZ=48.60000,7.80000,6.50&pitch=0&bearing=0";

/** The boxes the map holds, by the network their storm was found in: how many greyed, how many in colour. */
const boxes = (page: Page) => page.evaluate(() => {
  const gl = (window as any).lm.getCapability("cells3d").gl;
  if (!gl?.getLayer("cloud-box")) return null;
  const tally: Record<string, { greyed: number; colour: number }> = {};
  for (const feature of gl.querySourceFeatures("clouds")) {
    const network = /\/(\w+)-[^/]+$/.exec(feature.properties.path)?.[1] ?? "de";
    tally[network] ??= { greyed: 0, colour: 0 };
    tally[network][feature.properties.stale ? "greyed" : "colour"] += 1;
  }
  return tally;
});

test("boxes of storms a scan behind the radar are greyed, the rest in colour", async ({ page }) => {
  await open3d(page, BORDER_3D);
  await expect.poll(async () => Object.keys((await boxes(page)) ?? {}).length, { timeout: 20_000 }).toBeGreaterThan(1);
  const tally = (await boxes(page))!;
  expect(tally.de.greyed).toBeGreaterThan(0);
  expect(tally.de.colour).toBe(0);
  for (const network of ["fr", "ch"]) {
    expect(tally[network].colour).toBeGreaterThan(0);
    expect(tally[network].greyed).toBe(0);
  }
});
