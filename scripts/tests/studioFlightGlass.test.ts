import assert from "node:assert/strict";
import test from "node:test";
import { chargeOf, daylightOf, wetted, windowPanes } from "../../src/lib/studio/flight/glass.ts";
import { skyLighting } from "../../src/layers/aircraftRenderer.ts";

const fly = (seconds: number, from: number, air: Parameters<typeof wetted>[1]) => {
  let wet = from;
  for (let t = 0; t < seconds; t += 0.1) wet = wetted(wet, air, 0.1);
  return wet;
};

test("rain wets the windshield within a couple of seconds; warm cloud a little", () => {
  assert.ok(fly(3, 0, { rain: 1, cloud: 0, temperature: 10, tas: 130 }) > 0.95);
  const cloud = fly(5, 0, { rain: 0, cloud: 1, temperature: 10, tas: 130 });
  assert.ok(cloud > 0.4 && cloud < 0.5, String(cloud));
});

test("below freezing what strikes the glass is not water", () => {
  assert.equal(fly(5, 0, { rain: 1, cloud: 1, temperature: -10, tas: 130 }), 0);
});

test("out of the rain, the air blows the glass dry at speed; standing, it dries slowly", () => {
  const dry = { rain: 0, cloud: 0, temperature: 10 };
  assert.ok(fly(8, 1, { ...dry, tas: 130 }) < 0.05);
  assert.ok(fly(8, 1, { ...dry, tas: 0 }) > 0.8);
});

test("St Elmo's fire takes a storm's cloud, more where it is cold, and more with lightning nearby", () => {
  assert.equal(chargeOf({ cloud: 0, dbz: 55, temperature: -5 }), 0);
  assert.equal(chargeOf({ cloud: 1, dbz: 25, temperature: -5 }), 0);
  const warm = chargeOf({ cloud: 1, dbz: 50, temperature: 12 });
  const cold = chargeOf({ cloud: 1, dbz: 50, temperature: -5 });
  assert.ok(warm > 0 && cold > warm, `${warm} ${cold}`);
  assert.ok(chargeOf({ cloud: 1, dbz: 30, temperature: -5 }, 1) > 0.5);
  assert.ok(chargeOf({ cloud: 1, dbz: 70, temperature: -5 }, 1) <= 1);
});

test("cloud takes the sun off the flight deck, and a storm the sky's light too", () => {
  assert.deepEqual(daylightOf(0, null), { sun: 1, sky: 1 });
  const cloud = daylightOf(1, 20);
  assert.ok(cloud.sun < 0.1 && cloud.sky > 0.7, JSON.stringify(cloud));
  const storm = daylightOf(1, 55);
  assert.ok(storm.sun < cloud.sun && storm.sky < 0.4, JSON.stringify(storm));
});

test("the sky's light keeps its lighting in clear air, and in cloud keeps no side lit and none black", () => {
  assert.deepEqual(skyLighting([0.62, 0.42, 0.1]), [0.62, 0.42, 0.1]);
  const [ambient, lit, away] = skyLighting([0.62, 0.42, 0.1], 0, 0.35);
  assert.equal(lit, 0);
  assert.ok(ambient > 0.4 && away > 0, `${ambient} ${away}`);
});

test("each of the cockpit's six windows is a pane that ice grows in from the edges of", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseModel } = await import("../../src/lib/studio/flight/model.ts");
  const file = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
  const panes = windowPanes(parseModel(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
  assert.equal(panes.length, 6);
  for (const { plane, edges, depth } of panes) {
    assert.ok(edges.length >= 3 && edges.length <= 12, String(edges.length));
    // A window is some tens of centimetres across.
    assert.ok(depth > 0.08 && depth < 0.4, String(depth));
    // Every edge lies in the pane's plane.
    for (const edge of edges) assert.ok(Math.abs(edge[0] * plane[0] + edge[1] * plane[1] + edge[2] * plane[2]) < 1e-6);
  }
  // Left and right alike: as many windows face either way across.
  assert.equal(panes.filter(({ plane }) => plane[1] > 0).length, 3);
});

test("a point of a pane is deepest in its middle and at none of its edges", () => {
  // A square pane, a metre a side, facing forward, at x = 2.
  const vertices = new Uint8Array(4 * 16);
  const bytes = new DataView(vertices.buffer);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([y, z], i) => {
    bytes.setUint16(i * 16, 0, true);
    bytes.setUint16(i * 16 + 2, y * 65535, true);
    bytes.setUint16(i * 16 + 4, z * 65535, true);
  });
  const [pane] = windowPanes({
    title: "", author: "", licence: "", source: "", parts: {},
    materials: [{ texture: null, colour: [1, 1, 1], opacity: 0.4 }],
    chunks: [{ material: 0, vertices, indices: new Uint16Array([0, 1, 2, 0, 2, 3]), min: [2, -0.5, -0.5], size: [1, 1, 1], uvMin: [0, 0], uvSize: [1, 1] }],
  });
  assert.ok(Math.abs(pane.depth - 0.5) < 0.02, String(pane.depth));
  assert.equal(pane.edges.length, 4);
  const inFrom = (p: number[]) => Math.min(...pane.edges.map((e) => e[3] - (e[0] * p[0] + e[1] * p[1] + e[2] * p[2])));
  assert.ok(Math.abs(inFrom([2, 0, 0]) - 0.5) < 1e-6);
  assert.ok(Math.abs(inFrom([2, 0.5, 0.2])) < 1e-6);
  assert.ok(Math.abs(inFrom([2, 0.3, -0.5])) < 1e-6);
});
