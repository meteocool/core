import assert from "node:assert/strict";
import test from "node:test";
import { RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD } from "../../src/colormaps.ts";
import { dbz2color } from "../../src/lib/cmap_utils.ts";
import {
  RVP6_ENTRIES, carriesValues, drawnTileId, greyTable, paintValues, rvp6PaletteColours, rvp6Style, rvp6Table,
} from "../../src/lib/rvp6.ts";

test("the classic table is the classic palette, byte for byte, where it has colours", () => {
  const table = rvp6Table("classic");
  for (let i = RVP6_CLASSIC_LEFTPAD; i < RVP6_CLASSIC_LEFTPAD + RVP6_CLASSIC.length; i++) {
    assert.deepEqual(table[i], RVP6_CLASSIC[i - RVP6_CLASSIC_LEFTPAD], `index ${i}`);
  }
});

test("below the palette's first colour, and at 0, nothing is drawn", () => {
  const table = rvp6Table("classic");
  assert.deepEqual(table[0], [0, 0, 0, 0]);
  assert.deepEqual(table[RVP6_CLASSIC_LEFTPAD - 1], [0, 0, 0, 0]);
});

test("past the palette's end every index is its most intense colour, as the backend drew it", () => {
  const table = rvp6Table("classic");
  assert.equal(table.length, RVP6_ENTRIES);
  assert.deepEqual(table[RVP6_ENTRIES - 1], RVP6_CLASSIC[RVP6_CLASSIC.length - 1]);
});

test("every palette's table agrees with the legend at every half dBZ", () => {
  for (const name of ["nws", "viridis", "pyart_stepseq", "homeyer", "lang"]) {
    const table = rvp6Table(name);
    for (let i = 1; i < RVP6_ENTRIES; i++) assert.deepEqual(table[i], dbz2color(i / 2 - 32.5, name), `${name} ${i}`);
  }
});

test("the style is a palette lookup over band 1 with every index, faded by band 4", () => {
  const [multiply, lookup, alpha] = rvp6Style("viridis").color as [string, unknown[], unknown];
  assert.equal(multiply, "*");
  assert.deepEqual(alpha, ["color", 255, 255, 255, ["band", 4]]);
  const [op, index, colours] = lookup as [string, unknown, number[][]];
  assert.equal(op, "palette");
  assert.deepEqual(index, ["*", ["band", 1], 255]);
  assert.equal(colours.length, RVP6_ENTRIES);
  assert.deepEqual(colours[0], [0, 0, 0, 0]);
  const [r, g, b, a] = rvp6Table("viridis")[150];
  assert.deepEqual(colours[150], [r, g, b, a / 255]);
});

test("values are painted; an erased pixel stays transparent, a cut edge fades", () => {
  const table = rvp6Table("classic");
  const pixels = paintValues(new Uint8Array([150, 0, 150, 150]), new Uint8Array([255, 255, 0, 51]), table);
  assert.deepEqual([...pixels.slice(0, 4)], table[150]);
  assert.deepEqual([...pixels.slice(4, 8)], [0, 0, 0, 0]);
  assert.deepEqual([...pixels.slice(8, 12)], [0, 0, 0, 0]);
  const [r, g, b, a] = table[150];
  assert.deepEqual([...pixels.slice(12)], [r, g, b, Math.round(a / 5)]);
  assert.deepEqual([...paintValues(new Uint8Array([150]), null, table)], table[150], "uncut, every pixel is whole");
});

test("a frame carries values only when it says so in the encoding the client reads", () => {
  const values = { tile_id: "v", encoding: "rvp6-u8" };
  assert.equal(carriesValues({ values }), true);
  assert.equal(carriesValues({ values: null }), false);
  assert.equal(carriesValues({}), false);
  assert.equal(carriesValues({ values: { tile_id: "v", encoding: "hg-class-u8" } }), false);
  assert.equal(drawnTileId({ tile_id: "t", values }), "v");
  assert.equal(drawnTileId({ tile_id: "t" }), "t");
});

test("in grey, every class keeps the palette's alpha and darkens with dBZ in black ink", () => {
  const colour = rvp6Table("classic");
  const grey = greyTable("classic", "black");
  assert.equal(grey.length, RVP6_ENTRIES);
  let last = 255;
  for (let i = 1; i < RVP6_ENTRIES; i++) {
    const [r, g, b, a] = grey[i];
    assert.ok(r === g && g === b, `index ${i} is grey`);
    assert.equal(a, colour[i][3], `index ${i} keeps its alpha`);
    assert.ok(r <= last, `index ${i} is no lighter than the one before`);
    last = r;
  }
  assert.deepEqual(grey[RVP6_ENTRIES - 1], [0, 0, 0, colour[RVP6_ENTRIES - 1][3]]);
});

test("in white ink the strongest echo is white, for the dark basemap", () => {
  const grey = greyTable("viridis", "white");
  assert.equal(grey[RVP6_ENTRIES - 1][0], 255);
  assert.ok(grey[(20 + 32.5) * 2][0] < 255);
});

test("the style takes the grey with an ink, the colours without", () => {
  const colours = (ink: "black" | null) => ((rvp6Style("classic", ink).color as unknown[])[1] as [string, unknown, number[][]])[2];
  assert.deepEqual(colours(null), rvp6PaletteColours("classic"));
  assert.deepEqual(colours("black"), rvp6PaletteColours("classic", "black"));
  assert.notDeepEqual(colours("black"), colours(null));
});
