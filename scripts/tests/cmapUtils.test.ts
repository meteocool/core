import assert from "node:assert/strict";
import test from "node:test";
import { dbzTicks, getPalette, paletteFrom, rvp6ToDbz } from "../../src/lib/cmap_utils.ts";

test("an RVP6 byte is half a dBZ a step from -32.5", () => {
  assert.equal(rvp6ToDbz(65), 0);
  assert.equal(rvp6ToDbz(185), 60);
});

test("dBZ ticks sit on round tens, where they fall on the strip", () => {
  // Classic runs from 57 (-4 dBZ) to 185 (60 dBZ).
  const ticks = dbzTicks(getPalette("classic"));
  assert.deepEqual(ticks.map((tick) => tick.dbz), [0, 10, 20, 30, 40, 50, 60]);
  assert.equal(ticks[0].at, 4 / 64);
  assert.equal(ticks[ticks.length - 1].at, 1);
  assert.deepEqual(dbzTicks(""), []);
});

test("a palette cut from a value keeps that value and everything above it", () => {
  const palette = paletteFrom(getPalette("classic"), 5);
  const values = palette.split(";").map((entry) => rvp6ToDbz(Number(entry.split(":")[0])));
  assert.equal(values[0], 5);
  assert.equal(values[values.length - 1], 60);
  assert.ok(getPalette("classic").endsWith(palette));
});

test("cut at 5 dBZ, the ticks are still even", () => {
  const ticks = dbzTicks(paletteFrom(getPalette("classic"), 5));
  assert.deepEqual(ticks.map((tick) => tick.dbz), [10, 20, 30, 40, 50, 60]);
  const steps = ticks.slice(1).map((tick, i) => tick.at - ticks[i].at);
  steps.forEach((step) => assert.ok(Math.abs(step - 10 / 55) < 1e-9));
});
