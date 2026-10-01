import assert from "node:assert/strict";
import test from "node:test";
import { RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD, RVP6_NWS, RVP6_NWS_LEFTPAD } from "../../src/colormaps.ts";
import { dbz2color } from "../../src/lib/cmap_utils.ts";
import { recolourPixels, recolouringFor } from "../../src/layers/recolour.ts";

/** The classic colour the renderer paints this reflectivity in. */
const classicAt = (dbz: number) => RVP6_CLASSIC[Math.round((dbz + 32.5) * 2) - RVP6_CLASSIC_LEFTPAD];

test("the classic palette needs no recolouring", () => {
  assert.equal(recolouringFor("classic"), null);
});

test("a tile's colour becomes the palette's colour at the same reflectivity, as the legend draws it", () => {
  for (const name of ["nws", "viridis", "pyart_stepseq", "homeyer", "lang"]) {
    const table = recolouringFor(name)!;
    for (const dbz of [10, 25, 40, 55]) {
      const [r, g, b] = classicAt(dbz);
      assert.deepEqual(table.get((r << 16) | (g << 8) | b), dbz2color(dbz, name), `${name} at ${dbz} dBZ`);
    }
  }
});

test("not the palette's colour at the same position, which is a dBZ step off for every palette but classic", () => {
  // What DWD's WebGL layer used to do: classic colour i to NWS colour i, when
  // NWS starts 2.5 dBZ above classic.
  const table = recolouringFor("nws")!;
  const [r, g, b] = RVP6_CLASSIC[80];
  assert.notDeepEqual(table.get((r << 16) | (g << 8) | b), RVP6_NWS[80]);
  assert.deepEqual(table.get((r << 16) | (g << 8) | b), RVP6_NWS[80 + RVP6_CLASSIC_LEFTPAD - RVP6_NWS_LEFTPAD]);
});

test("pixels are recoloured in place; transparent and unknown ones are left alone", () => {
  const table = recolouringFor("viridis")!;
  const [r, g, b, a] = classicAt(40);
  const pixels = new Uint8ClampedArray([r, g, b, a, 0, 0, 0, 0, 1, 2, 3, 255]);
  recolourPixels(pixels, table);
  assert.deepEqual([...pixels.slice(0, 4)], dbz2color(40, "viridis"));
  assert.deepEqual([...pixels.slice(4)], [0, 0, 0, 0, 1, 2, 3, 255]);
});
