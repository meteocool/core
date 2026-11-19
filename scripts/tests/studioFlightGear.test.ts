import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CD_GEAR, GEAR_S, levelFlight, moveGear, NO_INPUT, step, STILL_AIR } from "../../src/lib/studio/flight/physics.ts";
import type { AircraftState, Environment } from "../../src/lib/studio/flight/physics.ts";
import { actionOf, isFlightKey } from "../../src/lib/studio/flight/controls.ts";
import { parseModel, partAngle, partPose, posedParts, VERTEX_BYTES } from "../../src/lib/studio/flight/model.ts";
import type { ModelPart } from "../../src/lib/studio/flight/model.ts";
import { GEAR_WIND, initialMemory, mixSound } from "../../src/lib/studio/flight/soundMix.ts";
import type { SoundEvent, SoundInput, SoundMemory, SoundStatus } from "../../src/lib/studio/flight/soundMix.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/* ---- the gear in the air ---- */

function cruise(seconds: number, env: Environment): AircraftState {
  let state = levelFlight(4.6, 43.3, 3000, 90, 140);
  for (let t = 0; t < seconds; t += 0.05) state = step(state, NO_INPUT, 0.05, env);
  return state;
}

test("the gear down drags: on the same throttle the aircraft slows, and up it does not", () => {
  const up = cruise(30, STILL_AIR);
  const down = cruise(30, { ...STILL_AIR, gear: 1 });
  const half = cruise(30, { ...STILL_AIR, gear: 0.5 });
  near(up.tas, 140, 0.5);
  assert.ok(down.tas < up.tas - 4, `${down.tas} against ${up.tas}`);
  assert.ok(half.tas < up.tas && half.tas > down.tas, `${half.tas} between ${down.tas} and ${up.tas}`);
  assert.ok(CD_GEAR > 0.01 && CD_GEAR < 0.03);
});

test("the gear takes its time to travel, and turns back where it is", () => {
  assert.equal(moveGear(0, true, GEAR_S / 2), 0.5);
  assert.equal(moveGear(0, true, GEAR_S * 2), 1);
  assert.equal(moveGear(1, false, GEAR_S * 2), 0);
  // Sent back halfway, it comes back from halfway.
  const halfway = moveGear(0, true, GEAR_S / 2);
  near(moveGear(halfway, false, GEAR_S / 4), 0.25, 1e-9);
  // Still where it was asked to be.
  assert.equal(moveGear(1, true, 0.1), 1);
  assert.equal(moveGear(0, false, 0.1), 0);
});

test("G puts the gear down or up, by its place on the keyboard", () => {
  assert.equal(actionOf("KeyG"), "gear");
  assert.ok(isFlightKey("KeyG"));
});

/* ---- its parts in the model ---- */

const LEG: ModelPart = { pivot: [0, 3, 1], axis: [1, 0, 0], keys: [[0, 90], [0.2, 90], [0.8, 0], [1, 0]] };

function moved(part: ModelPart, gear: number, point: [number, number, number]): number[] {
  const pose = partPose(part, gear);
  if (!pose) return point;
  const m = pose.matrix;
  return [0, 1, 2].map((row) => m[row] * point[0] + m[4 + row] * point[1] + m[8 + row] * point[2] + m[12 + row]);
}

test("a part's angle follows the gear through its keys, eased, and holds at either end", () => {
  assert.equal(partAngle(LEG, 0), 90);
  assert.equal(partAngle(LEG, 0.1), 90);
  near(partAngle(LEG, 0.5), 45, 1e-9);
  assert.ok(partAngle(LEG, 0.3) > 67.5, "eased: slow to leave");
  assert.equal(partAngle(LEG, 0.9), 0);
  assert.equal(partAngle(LEG, -1), 90);
  assert.equal(partAngle(LEG, 2), 0);
});

test("a leg turns about its hinge: down where the model has it, folded inward with the gear up", () => {
  assert.equal(partPose(LEG, 1), null);
  // The wheel 3 m under the hinge of a right leg, turned 90 degrees about the forward axis: 3 m inboard of it, level with it.
  const wheel = moved(LEG, 0, [0, 3, 4]);
  near(wheel[0], 0, 1e-9);
  near(wheel[1], 0, 1e-9);
  near(wheel[2], 1, 1e-9);
  // The hinge itself stays put.
  moved(LEG, 0.5, [0, 3, 1]).forEach((value, i) => near(value, LEG.pivot[i], 1e-9));
});

test("a turned part's normals meet the light as the part's own frame has it", () => {
  const light: [number, number, number] = [0, -0.6, -0.8];
  const posed = posedParts({ leg: LEG }, { gear: 0, flaps: 0, spoilers: 0 }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], light).get("leg")!;
  const turn = partPose(LEG, 0)!.turn;
  const normal = [0, 0, 1];
  const turned = turn.map((row) => row[0] * normal[0] + row[1] * normal[1] + row[2] * normal[2]);
  near(turned[0] * light[0] + turned[1] * light[1] + turned[2] * light[2],
    normal[0] * posed.light[0] + normal[1] * posed.light[1] + normal[2] * posed.light[2], 1e-9);
  assert.equal(posedParts({ leg: LEG }, { gear: 1, flaps: 1, spoilers: 1 }, posed.modelView, light).size, 0);
});

function file(header: object): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(header).padEnd(600, " "));
  const body = new Uint8Array(3 * VERTEX_BYTES + 8);
  const bytes = new Uint8Array(8 + text.length + body.length);
  bytes.set([0x4d, 0x43, 0x4d, 0x31]);
  new DataView(bytes.buffer).setUint32(4, text.length, true);
  bytes.set(text, 8);
  return bytes.buffer;
}

test("a model's moving parts are read with their chunks; one without parts is all fixed", () => {
  const chunk = { material: 0, vertices: 3, indices: 3, offset: 0, min: [0, 0, 0], size: [1, 1, 1], uvMin: [0, 0], uvSize: [1, 1] };
  const base = { title: "t", author: "a", licence: "l", source: "s", materials: [{ texture: null, colour: [1, 1, 1], opacity: 1 }] };
  const model = parseModel(file({ ...base, chunks: [chunk, { ...chunk, part: "leg" }, { ...chunk, part: "nowhere" }], parts: { leg: LEG } }));
  assert.deepEqual(model.chunks.map((one) => one.part), [undefined, "leg", undefined]);
  assert.deepEqual(model.parts.leg, LEG);
  assert.deepEqual(parseModel(file({ ...base, chunks: [chunk] })).parts, {});
});

test("the aircraft's own gear folds into it: up, no wheel hangs below the belly; down, the wheels stand under it", () => {
  const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
  const model = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const name of ["gear.nose", "gear.left", "gear.right"]) assert.ok(model.parts[name], name);
  const lowest = (gear: number, part: string) => {
    let low = -Infinity;
    for (const chunk of model.chunks.filter((one) => one.part === part)) {
      const view = new DataView(chunk.vertices.buffer, chunk.vertices.byteOffset, chunk.vertices.byteLength);
      for (let i = 0; i < chunk.vertices.byteLength / VERTEX_BYTES; i++) {
        const point = [0, 1, 2].map((k) => (view.getUint16(i * VERTEX_BYTES + k * 2, true) / 65535) * chunk.size[k] + chunk.min[k]) as [number, number, number];
        low = Math.max(low, moved(model.parts[part], gear, point)[2]);
      }
    }
    return low;
  };
  // The fuselage's lowest is a little over 2 m below its middle; the wheels stand 3.5 to 4 m below it.
  for (const part of ["gear.nose", "gear.left", "gear.right"]) {
    assert.ok(lowest(0, part) < 2.1, `${part} up reaches ${lowest(0, part)} m down`);
    assert.ok(lowest(1, part) > 3.5, `${part} down reaches ${lowest(1, part)} m down`);
  }
});

/* ---- its sound ---- */

const CRUISE: SoundInput = {
  throttle: 0.7, ias: 128, mach: 0.5, dbz: null, rain: 0, turbulence: 0, flash: 0, strike: false, brake: false, fade: 0, storm: null,
};
const STATUS: SoundStatus = { view: "cockpit", warnings: [], paused: false, autopilot: false, warp: false, low: false };
const never = () => 0.999999;

/** The gear's sounds as it travels from `from` to `to` and stays, and the memory after. */
function travel(from: number, to: number, memory: SoundMemory = initialMemory(CRUISE, STATUS)) {
  const events: SoundEvent[] = [];
  const frames = Math.ceil((Math.abs(to - from) * GEAR_S) * 60) + 30;
  let at = from;
  for (let i = 0; i < frames; i++) {
    at = moveGear(at, to > from, 1 / 60);
    const frame = mixSound(memory, { ...CRUISE, gear: at }, STATUS, false, 1 / 60, never);
    memory = frame.memory;
    events.push(...frame.events.filter((event) => event.kind.startsWith("gear")));
  }
  return { events, memory };
}

test("the gear's motor runs as it travels, and it locks with a thunk at the end, harder down than up", () => {
  const down = travel(0, 1);
  assert.deepEqual(down.events.map((event) => event.kind), ["gearMotor", "gearLock"]);
  const motor = down.events[0] as Extract<SoundEvent, { kind: "gearMotor" }>;
  near(motor.seconds, GEAR_S, 0.2);
  const up = travel(1, 0, down.memory);
  assert.deepEqual(up.events.map((event) => event.kind), ["gearMotor", "gearLock"]);
  const thunk = (events: SoundEvent[]) => (events[1] as Extract<SoundEvent, { kind: "gearLock" }>).strength;
  assert.ok(thunk(down.events) > thunk(up.events));
});

test("sent back on its way, the motor starts again for the way back; still, the gear is silent", () => {
  let memory = initialMemory(CRUISE, STATUS);
  const events: SoundEvent[] = [];
  let at = 0;
  for (const [down, seconds] of [[true, GEAR_S / 2], [false, GEAR_S]] as const) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      at = moveGear(at, down, 1 / 60);
      const frame = mixSound(memory, { ...CRUISE, gear: at }, STATUS, false, 1 / 60, never);
      memory = frame.memory;
      events.push(...frame.events.filter((event) => event.kind.startsWith("gear")));
    }
  }
  assert.deepEqual(events.map((event) => event.kind), ["gearMotor", "gearMotor", "gearLock"]);
  near((events[1] as Extract<SoundEvent, { kind: "gearMotor" }>).seconds, GEAR_S / 2, 0.2);
  for (let i = 0; i < 120; i++) {
    const frame = mixSound(memory, { ...CRUISE, gear: at }, STATUS, false, 1 / 60, never);
    memory = frame.memory;
    assert.equal(frame.events.filter((event) => event.kind.startsWith("gear")).length, 0);
  }
});

test("the wind is louder with the gear down", () => {
  const memory = initialMemory(CRUISE, STATUS);
  const up = mixSound(memory, CRUISE, STATUS, false, 1 / 60, never).levels.wind.gain;
  const down = mixSound(memory, { ...CRUISE, gear: 1 }, STATUS, false, 1 / 60, never).levels.wind.gain;
  near(down / up, 1 + GEAR_WIND, 1e-9);
});
