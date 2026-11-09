import assert from "node:assert/strict";
import test from "node:test";
import { RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD } from "../../src/colormaps.ts";
import { dbz2color, rvp6ToDbz } from "../../src/lib/cmap_utils.ts";
import { columnStyle, columnTable } from "../../src/lib/columnValues.ts";
import {
  RVP6_ENTRIES, carriesValues, columnGreyTable, drawnTileId, encodingOf, greyTable, paintValues, rvp6PaletteColours, rvp6Style,
  rvp6Table, valueStyle, valueTable,
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

test("a frame carries values only when it says so in an encoding the client reads", () => {
  const values = { tile_id: "v", encoding: "rvp6-u8" };
  assert.equal(carriesValues({ values }), true);
  assert.equal(carriesValues({ values: null }), false);
  assert.equal(carriesValues({}), false);
  assert.equal(carriesValues({ values: { tile_id: "v", encoding: "hg-class-u8" } }), false);
  assert.equal(carriesValues({ values: { tile_id: "v", encoding: "height-250m-u8" } }), true);
  assert.equal(carriesValues({ values: { tile_id: "v", encoding: "vil-0.5kg-u8" } }), true);
  assert.equal(carriesValues({ values: { tile_id: "v", encoding: "hail-u8" } }), false);
  assert.equal(drawnTileId({ tile_id: "t", values }), "v");
  assert.equal(drawnTileId({ tile_id: "t", values: { tile_id: "e", encoding: "height-250m-u8" } }), "e");
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

test("an RVP6 byte is half a dBZ a step from -32.5", () => {
  assert.equal(rvp6ToDbz(1), -32);
  assert.equal(rvp6ToDbz(65), 0);
  assert.equal(rvp6ToDbz(165), 50);
  assert.equal(rvp6ToDbz(255), 95);
});

test("a frame that does not say is RVP6, as every frame was before the column products", () => {
  assert.equal(encodingOf({}), "rvp6-u8");
  assert.equal(encodingOf({ values: null }), "rvp6-u8");
  assert.equal(encodingOf({ values: { tile_id: "v", encoding: "vil-0.5kg-u8" } }), "vil-0.5kg-u8");
});

test("a frame is drawn by its encoding: reflectivity in the reader's palette, a column product in its own", () => {
  assert.deepEqual(valueStyle("rvp6-u8", "viridis"), rvp6Style("viridis"));
  assert.deepEqual(valueStyle("rvp6-u8", "nws"), rvp6Style("nws"));
  for (const encoding of ["height-250m-u8", "vil-0.5kg-u8"] as const) {
    // Whatever the reader's palette is.
    assert.deepEqual(valueStyle(encoding, "viridis"), columnStyle(encoding));
    assert.deepEqual(valueStyle(encoding, "classic"), columnStyle(encoding));
  }
  assert.notDeepEqual(columnStyle("height-250m-u8"), columnStyle("vil-0.5kg-u8"));
  // Not read as dBZ: nothing at all.
  assert.deepEqual(valueStyle("hail-u8", "classic"), { color: [0, 0, 0, 0] });
  assert.deepEqual(valueStyle("hail-u8", "classic", "black"), { color: [0, 0, 0, 0] });
});

test("under an open radar's sweep, reflectivity takes the ink as it always has, and so does a column product", () => {
  assert.deepEqual(valueStyle("rvp6-u8", "classic", "black"), rvp6Style("classic", "black"));
  assert.deepEqual(valueStyle("rvp6-u8", "viridis", "white"), rvp6Style("viridis", "white"));
  for (const encoding of ["height-250m-u8", "vil-0.5kg-u8"] as const) {
    for (const ink of ["black", "white"] as const) {
      assert.deepEqual(valueStyle(encoding, "classic", ink), columnStyle(encoding, columnGreyTable(encoding, ink)));
    }
  }
});

test("a column product in grey keeps each byte's alpha and runs from the ink's faintest to full ink", () => {
  for (const encoding of ["height-250m-u8", "vil-0.5kg-u8"] as const) {
    const colour = columnTable(encoding);
    const black = columnGreyTable(encoding, "black");
    const white = columnGreyTable(encoding, "white");
    let last = 255;
    for (let byte = 1; byte < 255; byte++) {
      const [r, g, b, a] = black[byte];
      assert.ok(r === g && g === b, `${encoding} ${byte} is grey`);
      assert.equal(a, colour[byte][3], `${encoding} ${byte} keeps its alpha`);
      assert.ok(r <= last, `${encoding} ${byte} is no lighter than the one before`);
      last = r;
    }
    assert.equal(black[0][3], 0);
    assert.equal(black[255][3], 0);
    // The scale's top, and past it, is full ink.
    assert.equal(black[254][0], 0);
    assert.equal(white[254][0], 255);
    assert.ok(white[1][0] < 255);
  }
});

test("the frame layer's table colours every byte as the tile layers' style does", () => {
  assert.deepEqual(valueTable("rvp6-u8", "nws"), rvp6Table("nws"));
  assert.deepEqual(valueTable("rvp6-u8", "nws", "white"), greyTable("nws", "white"));
  assert.deepEqual(valueTable("height-250m-u8", "nws"), columnTable("height-250m-u8"), "an echo top keeps its own colours");
  assert.deepEqual(valueTable("vil-0.5kg-u8", "classic", "black"), columnGreyTable("vil-0.5kg-u8", "black"));
  const unknown = valueTable("something-else", "classic");
  assert.equal(unknown.length, RVP6_ENTRIES);
  assert.ok(unknown.every(([, , , a]) => a === 0), "an encoding this client cannot read draws nothing");
});
