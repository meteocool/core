import assert from "node:assert/strict";
import test from "node:test";
import { blendWeights, carried } from "../../src/layers/cellVolumeLayer.ts";
import { CLOUD_STYLES } from "../../src/lib/cloudStyle.ts";

const near = (a: number, b: number, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

test("between two scans the two weights always make one cloud", () => {
  for (const style of CLOUD_STYLES) {
    for (let f = 0; f <= 1; f += 0.05) {
      const [earlier, later] = blendWeights(f, style);
      near(earlier + later, 1);
      assert.ok(earlier >= 0 && later >= 0);
    }
    assert.deepEqual(blendWeights(0, style), [1, 0]);
    assert.deepEqual(blendWeights(1, style), [0, 1]);
  }
});

test("the clouds blend in proportion, the shells hand over in the middle third", () => {
  assert.deepEqual(blendWeights(0.25, "sky"), [0.75, 0.25]);
  assert.deepEqual(blendWeights(0.3, "shells"), [1, 0]);
  near(blendWeights(0.5, "shells")[1], 0.5);
  assert.deepEqual(blendWeights(0.7, "shells"), [0, 1]);
});

test("a storm's two scans, carried towards each other, stand in one place all the way", () => {
  // The later scan's box is the earlier one's moved by the storm's drift.
  const drift: [number, number] = [3e-5, -2e-5];
  const earlier = new Float64Array([1e-3, 0, 0, 0, 0, -1e-3, 0, 0, 0, 0, 1e-4, 0, 0.51, 0.37, 0, 1]);
  const later = new Float64Array(earlier);
  later[12] += drift[0];
  later[13] += drift[1];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const [a, b] = [carried(earlier, 0, drift, f), carried(later, 1, drift, f)];
    near(a[12], b[12]);
    near(a[13], b[13]);
    // Where the earlier one is at f: on its way, by that share of the drift.
    near(a[12], earlier[12] + drift[0] * f);
    // Scale untouched: a box moves, it does not grow.
    assert.equal(a[0], earlier[0]);
  }
  // At either end each stands on its own scan.
  assert.deepEqual([...carried(earlier, 0, drift, 0)], [...earlier]);
  assert.deepEqual([...carried(later, 1, drift, 1)], [...later]);
});
