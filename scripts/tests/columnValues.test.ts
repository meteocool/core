import assert from "node:assert/strict";
import test from "node:test";
import {
  ECHO_TOP_ENCODING, ECHO_TOP_SCALE, VIL_ENCODING, VIL_SCALE, colourAt, columnLegend, columnScale, columnStyle, columnTable,
  columnValue, isColumnEncoding, legendPosition,
} from "../../src/lib/columnValues.ts";
import type { Rgba } from "../../src/colormaps.ts";

/**
 * Echo tops and VIL as value tiles: what each byte measures, and the colour
 * it is drawn in. The API's `ValueTiles.encoding` says what the bytes are;
 * a wrong step here puts every storm a kilometre too high, or colours a top
 * as though it were VIL.
 */

test("an echo top's byte is 250 m a step above sea level", () => {
  assert.equal(columnValue(ECHO_TOP_ENCODING, 1), 0.25);
  assert.equal(columnValue(ECHO_TOP_ENCODING, 4), 1);
  assert.equal(columnValue(ECHO_TOP_ENCODING, 16), 4);
  assert.equal(columnValue(ECHO_TOP_ENCODING, 64), 16);
  assert.equal(columnValue(ECHO_TOP_ENCODING, 72), 18, "read to 18 km");
  assert.equal(columnValue(ECHO_TOP_ENCODING, 254), 63.5);
});

test("a VIL byte is half a kilogram a square metre a step", () => {
  assert.equal(columnValue(VIL_ENCODING, 1), 0.5);
  assert.equal(columnValue(VIL_ENCODING, 26), 13);
  assert.equal(columnValue(VIL_ENCODING, 90), 45);
  assert.equal(columnValue(VIL_ENCODING, 140), 70);
});

test("0, no echo at the threshold or no radar, and 255, no radar in the files, measure nothing", () => {
  for (const encoding of [ECHO_TOP_ENCODING, VIL_ENCODING] as const) {
    assert.equal(columnValue(encoding, 0), null);
    assert.equal(columnValue(encoding, 255), null);
    assert.equal(columnValue(encoding, -1), null);
    assert.equal(columnValue(encoding, 1.5), null);
    assert.equal(columnValue(encoding, 256), null);
  }
});

test("only the two column encodings are column encodings", () => {
  assert.ok(isColumnEncoding("height-250m-u8"));
  assert.ok(isColumnEncoding("vil-0.5kg-u8"));
  assert.ok(!isColumnEncoding("rvp6-u8"));
  assert.ok(!isColumnEncoding("hg-class-u8"));
  assert.ok(!isColumnEncoding(undefined));
  assert.equal(columnScale(ECHO_TOP_ENCODING), ECHO_TOP_SCALE);
  assert.equal(columnScale(VIL_ENCODING), VIL_SCALE);
});

test("every byte's colour is its value's on the scale, and 0 and 255 draw nothing", () => {
  for (const encoding of [ECHO_TOP_ENCODING, VIL_ENCODING] as const) {
    const table = columnTable(encoding);
    assert.equal(table.length, 256);
    assert.deepEqual(table[0], [0, 0, 0, 0]);
    assert.deepEqual(table[255], [0, 0, 0, 0]);
    for (let byte = 1; byte < 255; byte++) {
      assert.deepEqual(table[byte], colourAt(columnScale(encoding), columnValue(encoding, byte)!), `${encoding} ${byte}`);
      assert.ok(table[byte][3] > 0, `${encoding} ${byte} is drawn`);
    }
  }
});

test("a value on a stop is its colour, between two is between them, past the ends is the end", () => {
  assert.deepEqual(colourAt(ECHO_TOP_SCALE, 4), ECHO_TOP_SCALE.stops[2][1]);
  assert.deepEqual(colourAt(ECHO_TOP_SCALE, 16), ECHO_TOP_SCALE.stops[8][1]);
  assert.deepEqual(colourAt(ECHO_TOP_SCALE, 18), ECHO_TOP_SCALE.stops[8][1], "above 16 km is the top colour");
  assert.deepEqual(colourAt(VIL_SCALE, 0.25), VIL_SCALE.stops[0][1]);
  const [a, b] = [VIL_SCALE.stops[1][1], VIL_SCALE.stops[2][1]];
  assert.deepEqual(colourAt(VIL_SCALE, 1.5), [0, 1, 2, 3].map((c) => Math.round((a[c] + b[c]) / 2)));
});

/** WCAG's relative luminance: what a reader without colour vision still sees change. */
function luminance([r, g, b]: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

test("both palettes only brighten from less to more, so they read without colour vision", () => {
  for (const scale of [ECHO_TOP_SCALE, VIL_SCALE]) {
    const stops = scale.stops.map(([, colour]) => luminance(colour));
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i] > stops[i - 1], `${scale.unit} stop ${i}`);
    // The values rise along the scale too.
    for (let i = 1; i < scale.stops.length; i++) assert.ok(scale.stops[i][0] > scale.stops[i - 1][0]);
  }
});

test("the lowest values fade in, as reflectivity's do; the rest are opaque", () => {
  assert.ok(columnTable(ECHO_TOP_ENCODING)[1][3] < 255);
  assert.equal(columnTable(ECHO_TOP_ENCODING)[8][3], 255, "2 km");
  assert.ok(columnTable(VIL_ENCODING)[1][3] < columnTable(VIL_ENCODING)[2][3]);
  assert.equal(columnTable(VIL_ENCODING)[4][3], 255, "2 kg/m²");
});

test("the style is a palette lookup over band 1 in the encoding's own colours, faded by band 4", () => {
  for (const encoding of [ECHO_TOP_ENCODING, VIL_ENCODING] as const) {
    const [multiply, lookup, alpha] = columnStyle(encoding).color as [string, unknown[], unknown];
    assert.equal(multiply, "*");
    assert.deepEqual(alpha, ["color", 255, 255, 255, ["band", 4]]);
    const [op, index, colours] = lookup as [string, unknown, number[][]];
    assert.equal(op, "palette");
    assert.deepEqual(index, ["*", ["band", 1], 255]);
    assert.equal(colours.length, 256);
    const [r, g, b, a] = columnTable(encoding)[40];
    assert.deepEqual(colours[40], [r, g, b, a / 255]);
  }
});

test("the stops are evenly spaced along the legend, so VIL's crowded low end gets its share", () => {
  assert.equal(legendPosition(ECHO_TOP_SCALE, 0), 0);
  assert.equal(legendPosition(ECHO_TOP_SCALE, 8), 0.5);
  assert.equal(legendPosition(ECHO_TOP_SCALE, 16), 1);
  assert.equal(legendPosition(ECHO_TOP_SCALE, 20), 1);
  assert.equal(legendPosition(VIL_SCALE, 1), 0.1);
  assert.equal(legendPosition(VIL_SCALE, 10), 0.5);
  assert.equal(legendPosition(VIL_SCALE, 70), 1);
  assert.ok(Math.abs(legendPosition(VIL_SCALE, 3) - 0.25) < 1e-9);
});

test("the legend's strip runs from the first stop's colour to the last, ticks where their values fall", () => {
  for (const encoding of [ECHO_TOP_ENCODING, VIL_ENCODING] as const) {
    const scale = columnScale(encoding);
    const legend = columnLegend(encoding, 10);
    const entries = legend.palette.split(";");
    assert.equal(entries.length, 11);
    const hex = (colour: Rgba) => colour.map((c) => c.toString(16).padStart(2, "0")).join("");
    assert.equal(entries[0].split(":")[1], hex(scale.stops[0][1]));
    assert.equal(entries[10].split(":")[1], hex(scale.stops[scale.stops.length - 1][1]));
    assert.deepEqual(legend.ticks.map(({ value }) => value), scale.ticks);
    for (const { value, at } of legend.ticks) assert.equal(at, legendPosition(scale, value));
    assert.equal(legend.min, scale.step);
    assert.equal(legend.max, scale.stops[scale.stops.length - 1][0]);
  }
  assert.equal(columnLegend(ECHO_TOP_ENCODING).unit, "km");
  assert.equal(columnLegend(VIL_ENCODING).unit, "kg/m²");
});
