import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FAN_EXPOSURE_S, FAN_SHOWN_DEG_S, fanSpeed, parseModel, partAngle, partPose, posedParts, smearedParts, VERTEX_BYTES } from "../../src/lib/studio/flight/model.ts";
import type { AircraftModel, ModelPart, PartPositions } from "../../src/lib/studio/flight/model.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LIGHT: [number, number, number] = [0, 0, -1];
const at = (positions: Partial<PartPositions>): PartPositions => ({ gear: 1, flaps: 0, spoilers: 0, ...positions });

const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
const model: AircraftModel = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** Every point of a part of the model, turned as `degrees` of the fans has it: forward, right, down. */
function points(part: string, degrees = 0): number[][] {
  const pose = partPose(model.parts[part], degrees);
  const found: number[][] = [];
  for (const chunk of model.chunks.filter((one) => one.part === part)) {
    const view = new DataView(chunk.vertices.buffer, chunk.vertices.byteOffset, chunk.vertices.byteLength);
    for (let i = 0; i < chunk.vertices.byteLength / VERTEX_BYTES; i++) {
      const p = [0, 1, 2].map((k) => (view.getUint16(i * VERTEX_BYTES + k * 2, true) / 65535) * chunk.size[k] + chunk.min[k]);
      const m = pose?.matrix;
      found.push(m ? [0, 1, 2].map((row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]) : p);
    }
  }
  return found;
}

test("each engine has a fan of eighteen blades and a spinner, both spinning about the engine's axis with the fans", () => {
  for (const side of ["left", "right"]) {
    const fan = model.parts[`fan.${side}`];
    const spinner = model.parts[`spinner.${side}`];
    assert.ok(fan && spinner, side);
    assert.equal(fan.drive, "fans");
    assert.equal(spinner.drive, "fans");
    assert.equal(fan.blades, 18);
    assert.equal(spinner.blades, undefined);
    assert.deepEqual(fan.axis, [1, 0, 0]);
    near(Math.abs(fan.pivot[1]), 5.63, 0.01);
    near(fan.pivot[2], 2.11, 0.01);
    // In the intake, inside the blades' tips; and the spinner only as wide as the hub.
    const radius = (point: number[]) => Math.hypot(point[1] - fan.pivot[1], point[2] - fan.pivot[2]);
    const blades = points(`fan.${side}`);
    assert.ok(blades.length > 1000, `${blades.length}`);
    assert.ok(blades.every((point) => radius(point) < 1 && point[0] > 4.5 && point[0] < 5), side);
    assert.ok(points(`spinner.${side}`).every((point) => radius(point) < 0.34), side);
  }
});

test("a fan turned by one blade's share of the round is as it was", () => {
  const still = points("fan.left");
  const turned = points("fan.left", 20);
  // Each of a sample of its turned points lies on one of the still fan's.
  for (let i = 0; i < turned.length; i += 97) {
    const nearest = Math.min(...still.map((point) => Math.hypot(point[0] - turned[i][0], point[1] - turned[i][1], point[2] - turned[i][2])));
    assert.ok(nearest < 0.02, `${nearest} m off at ${turned[i]}`);
  }
});

test("the fans turn round and round: a whole turn on is where they were, and nothing else moves with them", () => {
  const fan = model.parts["fan.left"];
  near(partAngle(fan, 370), 10, 1e-9);
  near(partAngle(fan, -10), 350, 1e-9);
  near(partAngle(fan, 720), 0, 1e-9);
  const still = new Set(posedParts(model.parts, at({}), IDENTITY, LIGHT).keys());
  const moving = [...posedParts(model.parts, at({ fans: 47 }), IDENTITY, LIGHT).keys()].filter((name) => !still.has(name)).sort();
  assert.deepEqual(moving, ["fan.left", "fan.right", "spinner.left", "spinner.right"]);
});

test("a fan is smeared over no more than a blade's share of the round, a round part over a whole turn at most", () => {
  const parts: Record<string, ModelPart> = {
    fan: { pivot: [0, 0, 0], axis: [1, 0, 0], keys: [[0, 0], [360, 360]], drive: "fans", blades: 18 },
    spinner: { pivot: [0, 0, 0], axis: [1, 0, 0], keys: [[0, 0], [360, 360]], drive: "fans" },
    flap: { pivot: [0, 0, 0], axis: [0, 1, 0], keys: [[0, 0], [1, 35]], drive: "flaps" },
  };
  assert.equal(smearedParts(parts, at({ fans: 30 }), 0.5, IDENTITY, LIGHT).size, 0);
  // Seen from behind (the eye 10 m aft of them, looking forward), neither.
  const behind = [0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -10, 1];
  assert.equal(smearedParts(parts, at({ fans: 30 }), 500, behind, LIGHT).size, 0);
  const smeared = smearedParts(parts, at({ fans: 30 }), 500, IDENTITY, LIGHT);
  assert.deepEqual([...smeared.keys()].sort(), ["fan", "spinner"]);
  const fan = smeared.get("fan")!;
  const spinner = smeared.get("spinner")!;
  assert.equal(fan.copies.length, 10);
  assert.equal(spinner.copies.length, 16);
  // All of them together let through a tenth of what is behind them.
  near((1 - fan.opacity) ** fan.copies.length, 0.1, 1e-9);
  // The first copy where the fan is now; the last most of a blade's share back from it.
  const turnOf = (modelView: ArrayLike<number>) => (Math.atan2(modelView[6], modelView[5]) * 180) / Math.PI;
  near(turnOf(fan.copies[0].modelView), 30, 1e-4);
  near(turnOf(fan.copies[fan.copies.length - 1].modelView), 30 - 20 * (9 / 10), 1e-4);
});

test("the fans turn slowly enough to see at idle, faster with power to a blur, and stop with the engines", () => {
  near(fanSpeed(0), 300, 1e-9);
  assert.ok(fanSpeed(0) < FAN_SHOWN_DEG_S);
  assert.ok(fanSpeed(0) * FAN_EXPOSURE_S < 10, "sharp at idle");
  // Smeared over a whole blade's share from about half power.
  assert.ok(fanSpeed(0.5) * FAN_EXPOSURE_S >= 20, `${fanSpeed(0.5) * FAN_EXPOSURE_S}`);
  near(fanSpeed(1), 30_000, 1e-6);
  for (let spool = 0; spool < 1; spool += 0.1) assert.ok(fanSpeed(spool + 0.1) > fanSpeed(spool));
  assert.equal(fanSpeed(0.5, 0), 0);
  near(fanSpeed(0, 0.5), 150, 1e-9);
});
