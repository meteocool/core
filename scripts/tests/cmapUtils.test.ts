import assert from "node:assert/strict";
import test from "node:test";
import { dbzTicks, getPalette, rvp6ToDbz } from "../../src/lib/cmap_utils.ts";

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
