import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseModel, partAngle, partPose, posedParts, VERTEX_BYTES } from "../../src/lib/studio/flight/model.ts";
import type { AircraftModel, ModelPart, PartPositions } from "../../src/lib/studio/flight/model.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LIGHT: [number, number, number] = [0, 0, -1];
const at = (positions: Partial<PartPositions>): PartPositions => ({ gear: 1, flaps: 0, spoilers: 0, ...positions });

/* ---- what drives a part ---- */

const LEG: ModelPart = { pivot: [0, 3, 1], axis: [1, 0, 0], keys: [[0, 90], [1, 0]] };
const FLAP: ModelPart = { pivot: [-1, 5, 1], axis: [0, 1, 0], keys: [[0, 0], [1, 35]], drive: "flaps" };
const SPOILER: ModelPart = { pivot: [-0.5, 5, 0], axis: [0, 1, 0], keys: [[0, 0], [1, -50]], drive: "spoilers" };
const PARTS = { leg: LEG, flap: FLAP, spoiler: SPOILER };

test("each part moves with what drives it and nothing else; one that does not say moves with the gear", () => {
  assert.deepEqual([...posedParts(PARTS, at({}), IDENTITY, LIGHT).keys()], []);
  assert.deepEqual([...posedParts(PARTS, at({ flaps: 1 }), IDENTITY, LIGHT).keys()], ["flap"]);
  assert.deepEqual([...posedParts(PARTS, at({ spoilers: 0.5 }), IDENTITY, LIGHT).keys()], ["spoiler"]);
  assert.deepEqual([...posedParts(PARTS, at({ gear: 0 }), IDENTITY, LIGHT).keys()], ["leg"]);
  assert.deepEqual([...posedParts(PARTS, { gear: 0, flaps: 1, spoilers: 1 }, IDENTITY, LIGHT).keys()].sort(), ["flap", "leg", "spoiler"]);
});

/** A point of a part with what drives it at `position`. */
function moved(part: ModelPart, position: number, point: [number, number, number]): number[] {
  const pose = partPose(part, position);
  if (!pose) return point;
  const m = pose.matrix;
  return [0, 1, 2].map((row) => m[row] * point[0] + m[4 + row] * point[1] + m[8 + row] * point[2] + m[12 + row]);
}

test("about a hinge that points to the right, a positive angle is trailing edge down and a negative one up", () => {
  // A flap's trailing edge a metre behind its hinge, level with it: down, and a little forward, as the flap turns.
  const down = moved(FLAP, 1, [-2, 5, 1]);
  assert.ok(down[2] > 1.5, `${down[2]}`);
  near(down[1], 5, 1e-9);
  // A spoiler's goes up.
  const up = moved(SPOILER, 1, [-1.5, 5, 0]);
  assert.ok(up[2] < -0.7, `${up[2]}`);
});

/* ---- the aircraft's own ---- */

const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
const model: AircraftModel = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** Every point of a part of the model, with what drives it at `position`: forward, right, down. */
function points(part: string, position: number): number[][] {
  const found: number[][] = [];
  for (const chunk of model.chunks.filter((one) => one.part === part)) {
    const view = new DataView(chunk.vertices.buffer, chunk.vertices.byteOffset, chunk.vertices.byteLength);
    for (let i = 0; i < chunk.vertices.byteLength / VERTEX_BYTES; i++) {
      const point = [0, 1, 2].map((k) => (view.getUint16(i * VERTEX_BYTES + k * 2, true) / 65535) * chunk.size[k] + chunk.min[k]) as [number, number, number];
      found.push(moved(model.parts[part], position, point));
    }
  }
  return found;
}
const extreme = (part: string, position: number, axis: number, pick: (...values: number[]) => number) =>
  points(part, position).reduce((best, point) => pick(best, point[axis]), pick === Math.max ? -Infinity : Infinity);

const WINGS = ["left", "right"] as const;
const named = (kind: string) => Object.keys(model.parts).filter((name) => name.startsWith(`${kind}.`)).sort();

test("the model has its flaps, slats, spoilers and flap fairings on both wings, each drawn and each driven by the right lever", () => {
  assert.deepEqual(named("flap"), ["flap.leftInner", "flap.leftOuter", "flap.rightInner", "flap.rightOuter"]);
  assert.deepEqual(named("slat"), ["slat.leftInner", "slat.leftOuter", "slat.rightInner", "slat.rightOuter"]);
  assert.deepEqual(named("spoiler"), ["spoiler.leftInner", "spoiler.leftOuter", "spoiler.rightInner", "spoiler.rightOuter"]);
  assert.equal(named("fairing").length, 6);
  for (const name of [...named("flap"), ...named("slat"), ...named("fairing")]) assert.equal(model.parts[name].drive, "flaps", name);
  for (const name of named("spoiler")) assert.equal(model.parts[name].drive, "spoilers", name);
  for (const name of named("gear")) assert.equal(model.parts[name].drive ?? "gear", "gear", name);
  for (const name of Object.keys(model.parts)) assert.ok(model.chunks.some((chunk) => chunk.part === name), `${name} has nothing drawn`);
});

test("every surface is on the wing its name says, and its hinge points to the right", () => {
  for (const name of [...named("flap"), ...named("slat"), ...named("spoiler"), ...named("fairing")]) {
    const part = model.parts[name];
    const side = name.includes("left") ? -1 : 1;
    assert.equal(Math.sign(part.pivot[1]), side, name);
    assert.ok(points(name, 0).every((point) => Math.sign(point[1]) === side), name);
    assert.ok(part.axis[1] > 0.8, `${name} turns about ${part.axis}`);
    near(Math.hypot(...part.axis), 1, 1e-4);
  }
});

test("flaps out go aft and down, in steps as an A320's lever has them, the same on both wings", () => {
  for (const wing of WINGS) {
    for (const span of ["Inner", "Outer"]) {
      const name = `flap.${wing}${span}`;
      assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map((lever) => partAngle(model.parts[name], lever)), [0, 10, 15, 20, 35]);
      // Its trailing edge: further aft and well below where it was.
      assert.ok(extreme(name, 1, 0, Math.min) < extreme(name, 0, 0, Math.min) - 0.15, `${name} aft`);
      assert.ok(extreme(name, 1, 2, Math.max) > extreme(name, 0, 2, Math.max) + 0.5, `${name} down`);
      // And its leading edge has slid aft from under the wing.
      assert.ok(extreme(name, 1, 0, Math.max) < extreme(name, 0, 0, Math.max) - 0.3, `${name} slides`);
    }
  }
  for (const span of ["Inner", "Outer"]) {
    near(extreme(`flap.left${span}`, 1, 2, Math.max), extreme(`flap.right${span}`, 1, 2, Math.max), 0.05);
    near(extreme(`flap.left${span}`, 1, 0, Math.min), extreme(`flap.right${span}`, 1, 0, Math.min), 0.05);
  }
});

test("slats out go forward and down, before the flaps do much", () => {
  for (const name of named("slat")) {
    assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map((lever) => partAngle(model.parts[name], lever)), [0, -18, -22, -22, -27]);
    assert.ok(extreme(name, 1, 0, Math.max) > extreme(name, 0, 0, Math.max) + 0.1, `${name} forward`);
    assert.ok(extreme(name, 1, 2, Math.max) > extreme(name, 0, 2, Math.max) + 0.1, `${name} down`);
  }
});

test("spoilers stand up from their leading edges, which stay on the wing", () => {
  for (const name of named("spoiler")) {
    assert.equal(partAngle(model.parts[name], 1), -50);
    assert.ok(extreme(name, 1, 2, Math.min) < extreme(name, 0, 2, Math.min) - 0.3, `${name} up`);
    // No point of it sinks into the wing by more than a hand's width.
    assert.ok(extreme(name, 1, 2, Math.max) < extreme(name, 0, 2, Math.max) + 0.1, `${name} into the wing`);
  }
});

test("with everything in and flat, every surface is where the model has it", () => {
  const posed = posedParts(model.parts, { gear: 1, flaps: 0, spoilers: 0 }, IDENTITY, LIGHT);
  assert.deepEqual([...posed.keys()].filter((name) => !name.startsWith("gear.")), []);
});
