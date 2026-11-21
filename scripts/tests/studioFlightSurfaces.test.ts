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
  // But for a part that only carries another (the stick's pitch, which carries its roll).
  const carrying = new Set(Object.values(model.parts).map((part) => part.parent));
  for (const name of Object.keys(model.parts).filter((one) => !carrying.has(one))) {
    assert.ok(model.chunks.some((chunk) => chunk.part === name), `${name} has nothing drawn`);
  }
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

/* ---- what the stick and the pedals move ---- */

const CONTROLS = ["aileron.left", "aileron.right", "elevator.left", "elevator.right", "rudder"];
/**
 * A part's trailing edge, with what drives it at `position`: the middle of
 * its rearmost points as the model has them. On a swept surface that is its
 * tip's corner, where it is narrowest and moves least.
 */
function trailing(part: string, position: number): number[] {
  const still = points(part, 0);
  const rearmost = Math.min(...still.map((point) => point[0]));
  const edge = points(part, position).filter((_, i) => still[i][0] < rearmost + 0.25);
  return [0, 1, 2].map((axis) => edge.reduce((sum, point) => sum + point[axis], 0) / edge.length);
}

test("the model has its ailerons, elevators and rudder, each drawn, on its own side, and driven by the stick or the pedals", () => {
  for (const name of CONTROLS) {
    assert.ok(model.parts[name], name);
    assert.ok(model.chunks.some((chunk) => chunk.part === name), `${name} has nothing drawn`);
    near(Math.hypot(...model.parts[name].axis), 1, 1e-4);
    assert.equal(partAngle(model.parts[name], 0), 0, name);
  }
  assert.deepEqual(named("aileron").map((name) => model.parts[name].drive), ["ailerons", "ailerons"]);
  assert.deepEqual(named("elevator").map((name) => model.parts[name].drive), ["elevator", "elevator"]);
  assert.equal(model.parts.rudder.drive, "rudder");
  for (const name of [...named("aileron"), ...named("elevator")]) {
    const side = name.endsWith("left") ? -1 : 1;
    assert.ok(points(name, 0).every((point) => Math.sign(point[1]) === side), name);
    assert.ok(model.parts[name].axis[1] > 0.8, `${name} turns about ${model.parts[name].axis}`);
  }
  // The ailerons are the outermost of the trailing edge, beyond the flaps; the elevators behind everything but the rudder's top.
  assert.ok(extreme("aileron.right", 0, 1, Math.min) > extreme("flap.rightOuter", 0, 1, Math.max));
  assert.ok(extreme("aileron.left", 0, 1, Math.max) < extreme("flap.leftOuter", 0, 1, Math.min));
  assert.ok(extreme("elevator.right", 0, 0, Math.max) < -16);
  assert.ok(model.parts.rudder.axis[2] < -0.8, "the rudder's hinge stands up");
  assert.ok(points("rudder", 0).every((point) => Math.abs(point[1]) < 0.3 && point[2] < -1.5));
});

test("a positive `ailerons` raises the right aileron's trailing edge and lowers the left one's, as far as an A320's go", () => {
  near(partAngle(model.parts["aileron.right"], 1), -25, 1e-9);
  near(partAngle(model.parts["aileron.left"], 1), 25, 1e-9);
  near(partAngle(model.parts["aileron.right"], -1), 25, 1e-9);
  // Down is positive: up is less of it.
  assert.ok(trailing("aileron.right", 1)[2] < trailing("aileron.right", 0)[2] - 0.2);
  assert.ok(trailing("aileron.left", 1)[2] > trailing("aileron.left", 0)[2] + 0.2);
  assert.ok(trailing("aileron.right", -1)[2] > trailing("aileron.right", 0)[2] + 0.2);
  assert.ok(trailing("aileron.left", -1)[2] < trailing("aileron.left", 0)[2] - 0.2);
  // The two wings mirror each other.
  near(trailing("aileron.right", 1)[2] - trailing("aileron.right", 0)[2], trailing("aileron.left", -1)[2] - trailing("aileron.left", 0)[2], 0.02);
});

test("a positive `elevator` raises both elevators' trailing edges, further than a negative one lowers them", () => {
  for (const name of named("elevator")) {
    near(partAngle(model.parts[name], 1), -30, 1e-9);
    near(partAngle(model.parts[name], -1), 17, 1e-9);
    const up = trailing(name, 0)[2] - trailing(name, 1)[2];
    const down = trailing(name, -1)[2] - trailing(name, 0)[2];
    assert.ok(up > 0.2, `${name} up ${up}`);
    assert.ok(down > 0.1 && down < up, `${name} down ${down}`);
  }
  near(trailing("elevator.left", 1)[2], trailing("elevator.right", 1)[2], 0.03);
});

test("a positive `rudder` swings the rudder's trailing edge to the right, and a negative one to the left", () => {
  near(partAngle(model.parts.rudder, 1), 25, 1e-9);
  assert.ok(trailing("rudder", 1)[1] > 0.25, `${trailing("rudder", 1)}`);
  assert.ok(trailing("rudder", -1)[1] < -0.25, `${trailing("rudder", -1)}`);
  near(trailing("rudder", 0)[1], 0, 0.02);
});

test("a surface follows the stick straight, and holds at its stops", () => {
  near(partAngle(model.parts["aileron.right"], 0.5), -12.5, 1e-9);
  near(partAngle(model.parts["aileron.right"], -0.2), 5, 1e-9);
  near(partAngle(model.parts["elevator.left"], 0.1), -3, 1e-9);
  near(partAngle(model.parts.rudder, 3), 25, 1e-9);
  near(partAngle(model.parts.rudder, -3), -25, 1e-9);
});

test("each surface turns about its own nose: deflected all the way, its nose has hardly left its slot", () => {
  for (const name of CONTROLS) {
    const still = points(name, 0);
    for (const position of [-1, 1]) {
      const now = points(name, position);
      // The nose: what is within a hand's width of the hinge.
      const part = model.parts[name];
      const fromHinge = (point: number[]) => {
        const from = point.map((value, axis) => value - part.pivot[axis]);
        const along = from[0] * part.axis[0] + from[1] * part.axis[1] + from[2] * part.axis[2];
        return Math.hypot(...from.map((value, axis) => value - along * part.axis[axis]));
      };
      const noses = still.map((point, i) => [fromHinge(point), Math.hypot(...point.map((value, axis) => value - now[i][axis]))]).filter(([reach]) => reach < 0.12);
      assert.ok(noses.length > 4, `${name} has a nose at its hinge`);
      assert.ok(noses.every(([, shift]) => shift < 0.07), `${name} nose moves ${Math.max(...noses.map(([, shift]) => shift))}`);
    }
  }
});

test("only what a control drives moves with it, and nothing does in the middle", () => {
  // But for the gear's own, which is down here.
  const moving = (positions: Partial<PartPositions>) =>
    [...posedParts(model.parts, at(positions), IDENTITY, LIGHT).keys()].filter((name) => !name.startsWith("gear.")).sort();
  assert.deepEqual(moving({ ailerons: 0.4 }), ["aileron.left", "aileron.right"]);
  assert.deepEqual(moving({ elevator: -0.4 }), ["elevator.left", "elevator.right"]);
  assert.deepEqual(moving({ rudder: 1 }), ["rudder"]);
  assert.deepEqual(moving({ ailerons: 0, elevator: 0, rudder: 0 }), []);
});
