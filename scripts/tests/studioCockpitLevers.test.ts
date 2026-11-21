import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { easeLevers, leverTargets, LEVERS_AT_REST } from "../../src/lib/studio/flight/levers.ts";
import type { LeverInputs, Levers } from "../../src/lib/studio/flight/levers.ts";
import { cockpitDrives, parseModel, partPose, posedParts, THRUST_DETENTS, VERTEX_BYTES } from "../../src/lib/studio/flight/model.ts";
import type { AircraftModel, ModelPart, PartPositions } from "../../src/lib/studio/flight/model.ts";
import { controlAlong, SEAT } from "../../src/lib/studio/flight/cockpit.ts";
import type { CockpitControlName } from "../../src/lib/studio/flight/cockpit.ts";
import type { Vec3 } from "../../src/lib/studio/flight/view.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LIGHT: Vec3 = [0, 0, -1];

const QUIET: LeverInputs = {
  pitch: 0, roll: 0, yaw: 0, trim: 0, throttle: 0, reverse: 0, alphaFloor: false, flapLever: 0, gearDown: false, speedBrake: false,
  parkingBrake: false,
};

/* ---- where the controls are put ---- */

test("the stick and the pedals are where they are asked to be; let go, or flown by the autopilot, they stand upright and level", () => {
  const put = leverTargets({ ...QUIET, pitch: 0.5, roll: -1, yaw: 0.3 });
  assert.deepEqual([put.stickPitch, put.stickRoll, put.pedals], [0.5, -1, 0.3]);
  assert.deepEqual(leverTargets(QUIET), LEVERS_AT_REST);
  // Past the stops they go no further.
  assert.equal(leverTargets({ ...QUIET, pitch: 3 }).stickPitch, 1);
});

test("the thrust levers are the throttle, and pulled back into reverse with the reversers; alpha floor leaves them where they are", () => {
  assert.equal(leverTargets({ ...QUIET, throttle: 0.6 }).thrust, 0.6);
  assert.equal(leverTargets({ ...QUIET, reverse: 1 }).thrust, -1);
  const before: Levers = { ...LEVERS_AT_REST, thrust: 0.3 };
  assert.equal(leverTargets({ ...QUIET, throttle: 1, alphaFloor: true }, before).thrust, 0.3);
  assert.ok(THRUST_DETENTS.idle < THRUST_DETENTS.climb && THRUST_DETENTS.climb < THRUST_DETENTS.maxContinuous && THRUST_DETENTS.maxContinuous < 1);
});

test("the flap, gear and speed brake levers and the parking brake are where they were put; gear down and speed brake in arms the spoilers", () => {
  const landing = leverTargets({ ...QUIET, flapLever: 4, gearDown: true, parkingBrake: true });
  assert.deepEqual([landing.flapLever, landing.gearLever, landing.groundSpoilersArmed, landing.speedBrake, landing.parkingBrake], [4, 1, 1, 0, 1]);
  const braking = leverTargets({ ...QUIET, gearDown: true, speedBrake: true });
  assert.deepEqual([braking.speedBrake, braking.groundSpoilersArmed], [1, 0]);
  assert.equal(leverTargets({ ...QUIET, trim: -1 }).rudderTrim, -1);
});

test("a key does not snap the stick over, nor a lever into its notch: each gets there a moment later", () => {
  const to = leverTargets({ ...QUIET, roll: 1, flapLever: 1, gearDown: true });
  const frame = easeLevers(LEVERS_AT_REST, to, 1 / 60);
  assert.ok(frame.stickRoll > 0 && frame.stickRoll < 0.3, `stick ${frame.stickRoll}`);
  assert.ok(frame.flapLever > 0 && frame.flapLever < 0.2, `flap lever ${frame.flapLever}`);
  assert.ok(frame.gearLever > 0 && frame.gearLever < 0.1, `gear lever ${frame.gearLever}`);
  let now = LEVERS_AT_REST;
  for (let i = 0; i < 30; i += 1) now = easeLevers(now, to, 1 / 60);
  near(now.stickRoll, 1, 0.01);
  assert.equal(now.flapLever, 1);
  assert.equal(now.gearLever, 1);
  // A thrown lever does not overshoot, and a frame of nothing moves nothing.
  assert.deepEqual(easeLevers(now, to, 0), now);
});

test("a pose drives the model's controls by name, and no pose leaves them as the model has them", () => {
  assert.deepEqual(cockpitDrives(undefined), {});
  assert.deepEqual(cockpitDrives({ thrust: 1, flapLever: 2, gearLever: 1 }), {
    stickPitch: 0, stickRoll: 0, thrustLevers: 1, flapLever: 2, speedBrakeLever: 0, spoilersArmed: 0, gearLever: 1, pedals: 0,
    parkingBrake: 0, rudderTrim: 0,
  });
});

/* ---- a part carried by another, and one that slides ---- */

const PITCH: ModelPart = { pivot: [0, 0, 0], axis: [0, 1, 0], keys: [[-1, -90], [0, 0], [1, 90]], drive: "stickPitch" };
const ROLL: ModelPart = { pivot: [0, 0, 0], axis: [1, 0, 0], keys: [[-1, -90], [0, 0], [1, 90]], drive: "stickRoll", parent: "pitch" };
const SLIDE: ModelPart = { pivot: [0, 0, 0], axis: [0, 0, -1], keys: [[0, 0], [1, 0.01]], drive: "spoilersArmed", slide: true };
const at = (positions: Partial<PartPositions>): PartPositions => ({ gear: 1, flaps: 0, spoilers: 0, ...positions });

function apply(matrix: ArrayLike<number>, [x, y, z]: Vec3): number[] {
  return [0, 1, 2].map((row) => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]);
}

test("a part carried by another moves with it and on it; its parent moves it even where it does not move itself", () => {
  const parts = { pitch: PITCH, roll: ROLL };
  const top: Vec3 = [0, 0, -1];
  // Pitched back a right angle, the top of the stick is aft; rolled as well, it is still aft, turned on its own axis.
  const pitched = posedParts(parts, at({ stickPitch: 1 }), IDENTITY, LIGHT).get("roll")!;
  apply(pitched.modelView, top).forEach((value, i) => near(value, [-1, 0, 0][i], 1e-6));
  const rolled = posedParts(parts, at({ stickRoll: 1 }), IDENTITY, LIGHT).get("roll")!;
  apply(rolled.modelView, top).forEach((value, i) => near(value, [0, 1, 0][i], 1e-6));
  // The light is turned with the part: what lit its top now lights the side it has turned to.
  rolled.light.forEach((value, i) => near(value, [0, -1, 0][i], 1e-6));
  assert.equal(posedParts(parts, at({}), IDENTITY, LIGHT).size, 0);
});

test("a part that slides goes along its axis by the keys' metres, and does not turn", () => {
  const pose = partPose(SLIDE, 1)!;
  apply(pose.matrix, [1, 2, 3]).forEach((value, i) => near(value, [1, 2, 2.99][i], 1e-9));
  assert.deepEqual(pose.turn, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  assert.equal(partPose(SLIDE, 0), null);
});

/* ---- the aircraft's own ---- */

const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
const model: AircraftModel = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const LIFTED = [
  "sidestick.captain", "speedBrakeLever", "gearLever", "parkingBrake", "knob.rudderTrim",
  "pedal.captainLeft", "pedal.captainRight", "pedal.firstOfficerLeft", "pedal.firstOfficerRight",
  "thrustLever.left", "thrustLever.right", "flapLever",
];

/** Every point of a part, with the flight deck as `pose` has it. */
function points(part: string, pose: Partial<Levers>): Vec3[] {
  const moved = posedParts(model.parts, at(cockpitDrives({ ...LEVERS_AT_REST, ...pose })), IDENTITY, LIGHT).get(part)?.modelView ?? IDENTITY;
  const found: Vec3[] = [];
  for (const chunk of model.chunks.filter((one) => one.part === part)) {
    const view = new DataView(chunk.vertices.buffer, chunk.vertices.byteOffset, chunk.vertices.byteLength);
    for (let i = 0; i < chunk.vertices.byteLength / VERTEX_BYTES; i++) {
      const point = [0, 1, 2].map((k) => (view.getUint16(i * VERTEX_BYTES + k * 2, true) / 65535) * chunk.size[k] + chunk.min[k]) as Vec3;
      found.push(apply(moved, point) as Vec3);
    }
  }
  return found;
}
/** The middle of a part's highest points (its handle, its knob): the few centimetres of it furthest up. */
function handle(part: string, pose: Partial<Levers>, within = 0.015): Vec3 {
  const all = points(part, pose);
  const top = Math.min(...all.map((point) => point[2]));
  const high = all.filter((point) => point[2] < top + within);
  return [0, 1, 2].map((k) => high.reduce((sum, point) => sum + point[k], 0) / high.length) as Vec3;
}
const middle = (part: string, pose: Partial<Levers>): Vec3 => {
  const all = points(part, pose);
  return [0, 1, 2].map((k) => all.reduce((sum, point) => sum + point[k], 0) / all.length) as Vec3;
};

test("the model has the flight deck's controls as parts, each drawn, and at rest each is where the model has it", () => {
  for (const name of LIFTED) {
    assert.ok(model.parts[name], name);
    assert.ok(model.chunks.some((chunk) => chunk.part === name), `${name} has nothing drawn`);
  }
  assert.equal(model.parts["sidestick.captain"].parent, "sidestick.captain.pitch");
  assert.equal(model.parts.speedBrakeLever.parent, "speedBrakeLever.armed");
  // But for the gear's own, which is down here.
  const moved = [...posedParts(model.parts, at(cockpitDrives(LEVERS_AT_REST)), IDENTITY, LIGHT).keys()].filter((name) => !name.startsWith("gear."));
  assert.deepEqual(moved, []);
});

test("the sidestick goes back for nose up and right for right wing down, some sixteen and twenty degrees", () => {
  const upright = handle("sidestick.captain", {});
  const back = handle("sidestick.captain", { stickPitch: 1 });
  const right = handle("sidestick.captain", { stickRoll: 1 });
  assert.ok(back[0] < upright[0] - 0.03, `back ${back[0] - upright[0]}`);
  near(back[1], upright[1], 0.005);
  assert.ok(right[1] > upright[1] + 0.035, `right ${right[1] - upright[1]}`);
  assert.ok(handle("sidestick.captain", { stickPitch: -1 })[0] > upright[0] + 0.02);
});

test("the thrust levers stand upright in the climb detent, ahead of it at TOGA, behind it at idle and further back in reverse", () => {
  for (const lever of ["thrustLever.left", "thrustLever.right"]) {
    const x = (thrust: number) => handle(lever, { thrust })[0];
    // The quadrant's arc is about 15.115 m forward of the middle.
    near(x(THRUST_DETENTS.climb), 15.115, 0.006);
    assert.ok(x(1) > x(THRUST_DETENTS.maxContinuous) && x(THRUST_DETENTS.maxContinuous) > x(THRUST_DETENTS.climb));
    assert.ok(x(THRUST_DETENTS.climb) > x(0) && x(0) > x(-1));
    assert.ok(x(1) - x(0) > 0.1, "a long throw");
  }
  assert.ok(middle("thrustLever.left", {})[1] < 0 && middle("thrustLever.right", {})[1] > 0);
});

test("the flap lever steps aft from 0 to FULL past the gate's marks; the speed brake's goes aft, the gear's down", () => {
  const flap = [0, 1, 2, 3, 4].map((flapLever) => handle("flapLever", { flapLever })[0]);
  for (let i = 1; i < 5; i += 1) assert.ok(flap[i] < flap[i - 1] - 0.01, `detent ${i}: ${flap}`);
  assert.ok(handle("speedBrakeLever", { speedBrake: 1 })[0] < handle("speedBrakeLever", {})[0] - 0.04);
  assert.ok(handle("speedBrakeLever", { groundSpoilersArmed: 1 })[2] < handle("speedBrakeLever", {})[2] - 0.005, "pulled up");
  assert.ok(middle("gearLever", { gearLever: 1 })[2] > middle("gearLever", {})[2] + 0.03, "down");
});

test("the pedals: the right one forward as the left goes back, on both sides; the parking brake turns in place", () => {
  for (const seat of ["captain", "firstOfficer"]) {
    const [left, right] = [`pedal.${seat}Left`, `pedal.${seat}Right`];
    assert.ok(middle(right, { pedals: 1 })[0] > middle(right, {})[0] + 0.04, `${right} forward`);
    assert.ok(middle(left, { pedals: 1 })[0] < middle(left, {})[0] - 0.04, `${left} back`);
    assert.ok(middle(left, { pedals: -1 })[0] > middle(left, {})[0] + 0.04, `${left} forward`);
  }
  const [off, on] = [middle("parkingBrake", {}), middle("parkingBrake", { parkingBrake: 1 })];
  near(on[2], off[2], 1e-6);
  assert.ok(Math.hypot(on[0] - off[0], on[1] - off[1]) < 0.03);
});

/** The control a look from the seat at a point meets. */
const met = (point: Vec3): CockpitControlName | undefined => controlAlong(SEAT, [point[0] - SEAT[0], point[1] - SEAT[1], point[2] - SEAT[2]])?.name;

test("a click on a lever where it has moved to still takes hold of it", () => {
  for (const thrust of [-1, 0, THRUST_DETENTS.climb, 1]) {
    for (const lever of ["thrustLever.left", "thrustLever.right"]) assert.equal(met(handle(lever, { thrust })), "thrust", `${lever} at ${thrust}`);
  }
  for (const flapLever of [0, 2, 4]) assert.equal(met(handle("flapLever", { flapLever })), "flaps", `flaps ${flapLever}`);
  for (const speedBrake of [0, 1]) assert.equal(met(handle("speedBrakeLever", { speedBrake })), "speedBrake", `speed brake ${speedBrake}`);
  for (const gearLever of [0, 1]) assert.equal(met(middle("gearLever", { gearLever })), "gear", `gear ${gearLever}`);
  for (const pose of [{}, { stickPitch: 1 }, { stickPitch: -1, stickRoll: 1 }, { stickRoll: -1 }]) {
    assert.equal(met(handle("sidestick.captain", pose, 0.05)), "sidestick", JSON.stringify(pose));
  }
  for (const pedals of [-1, 0, 1]) {
    assert.equal(met(middle("pedal.captainLeft", { pedals })), "pedals", `left pedal ${pedals}`);
    assert.equal(met(middle("pedal.captainRight", { pedals })), "pedals", `right pedal ${pedals}`);
  }
  for (const parkingBrake of [0, 1]) assert.equal(met(middle("parkingBrake", { parkingBrake })), "parkingBrake");
});
