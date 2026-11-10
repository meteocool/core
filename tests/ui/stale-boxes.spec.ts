import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { open3d } from "./app";
import { volumesBehind } from "./storms";

/**
 * The 3D map's boxes on the ground, greyed for a storm a scan behind the
 * radar draped under it, as the flat map's "3D" tag is. France's volumes are
 * put a scan behind its radar, Switzerland's left their radar's own scan:
 * over the Rhône, where the recording has storms of both.
 */
const BORDER_3D = "/?layer=cells3d&latLonZ=45.30000,4.50000,6.50&pitch=0&bearing=0";

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
  await volumesBehind(page, "fr");
  await open3d(page, BORDER_3D);
  // Both networks' boxes in, whichever comes first: Germany's may be the other one.
  await expect.poll(async () => {
    const tally = await boxes(page);
    return Boolean(tally?.fr && tally?.ch);
  }, { timeout: 20_000 }).toBe(true);
  const tally = (await boxes(page))!;
  expect(tally.fr.greyed).toBeGreaterThan(0);
  expect(tally.fr.colour).toBe(0);
  expect(tally.ch.colour).toBeGreaterThan(0);
  expect(tally.ch.greyed).toBe(0);
});

/** The 3D map's layers from the bottom up, and the colour of the boxes' halo. */
const boxLayers = (page: Page) => page.evaluate(() => {
  const gl = (window as any).lm.getCapability("cells3d").gl;
  if (!gl?.getLayer("cloud-box")) return null;
  const order = gl.getStyle().layers.map((layer: { id: string }) => layer.id);
  return {
    halo: order.indexOf("cloud-box-casing"),
    outline: order.indexOf("cloud-box"),
    colour: String(gl.getPaintProperty("cloud-box-casing", "line-color")),
  };
});

for (const [scheme, halo] of [["dark", /^rgba\(255, 255, 255/], ["light", /^rgba\(17, 20, 26/]] as const) {
  test.describe(`on a ${scheme} map`, () => {
    test.use({ colorScheme: scheme });
    test("every box's outline has a halo under it, against the map", async ({ page }) => {
      await open3d(page, BORDER_3D);
      await expect.poll(() => boxLayers(page), { timeout: 20_000 }).not.toBeNull();
      const layers = (await boxLayers(page))!;
      expect(layers.halo).toBeGreaterThanOrEqual(0);
      expect(layers.halo).toBeLessThan(layers.outline);
      expect(layers.colour).toMatch(halo);
    });
  });
}
