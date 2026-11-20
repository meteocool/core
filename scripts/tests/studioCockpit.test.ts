import assert from "node:assert/strict";
import test from "node:test";
import {
  airTemperatures, baroOf, cabinOf, ecamOf, egtOf, EGT_RED, fcuOf, flashOn, flightLevel, flightPlanPage, fuelFlowOf, gearLights,
  MACH_ABOVE_FT, minutesSeconds, N1_IDLE, N1_MAX, n1Of, progressPage, utc,
} from "../../src/lib/studio/flight/displays.ts";
import type { EcamInput } from "../../src/lib/studio/flight/displays.ts";
import { COCKPIT_CONTROLS, COCKPIT_LIGHTS, COCKPIT_SCREENS, controlAlong, lifted, mirrored, partOf, SEAT } from "../../src/lib/studio/flight/cockpit.ts";
import type { CockpitControl, CockpitControlName, ControlFace, Quad } from "../../src/lib/studio/flight/cockpit.ts";
import { actionOf, gamepadActions, isFlightKey } from "../../src/lib/studio/flight/controls.ts";
import type { FlightAction } from "../../src/lib/studio/flight/controls.ts";
import { lookedAlong, seenFrom } from "../../src/lib/studio/flight/view.ts";
import type { Vec3 } from "../../src/lib/studio/flight/view.ts";
import { levelFlight, MMO, NO_INPUT, step, STILL_AIR, VMO_MS } from "../../src/lib/studio/flight/physics.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const FEET = 3.28084;
const KNOTS = 1.943844;

/* ---- engines ---- */

test("N1 runs from idle to full with the spool, and the needle lags the lever as the engines do", () => {
  assert.equal(n1Of(0), N1_IDLE);
  assert.equal(n1Of(1), N1_MAX);
  assert.equal(n1Of(2), N1_MAX);
  // Lever slammed forward: a second later the engines are on their way, not there.
  let state = { ...levelFlight(3, 43, 7000, 90, 200), throttle: 0.2, spool: 0.2 };
  for (let i = 0; i < 20; i += 1) state = step(state, { ...NO_INPUT, throttle: 1 }, 0.05, STILL_AIR);
  assert.ok(state.throttle > 0.5, `lever ${state.throttle}`);
  assert.ok(n1Of(state.spool) < n1Of(state.throttle) - 3, `N1 ${n1Of(state.spool)} against the lever's ${n1Of(state.throttle)}`);
  assert.ok(n1Of(state.spool) > n1Of(0.2));
});

test("the exhaust runs hotter and the fuel flows faster with thrust, short of the red line, and less of it up high", () => {
  assert.ok(egtOf(n1Of(1)) < EGT_RED);
  assert.ok(egtOf(n1Of(0.8)) > egtOf(n1Of(0.3)));
  assert.ok(fuelFlowOf(0.8, 3000) > fuelFlowOf(0.3, 3000));
  assert.ok(fuelFlowOf(0.7, 11_000) < fuelFlowOf(0.7, 0));
  // An airliner in cruise burns roughly a tonne an hour an engine.
  const cruise = fuelFlowOf(0.7, 11_000);
  assert.ok(cruise > 700 && cruise < 1600, `cruise flow ${cruise}`);
});

test("the air outside: standard at the height, the probe warmed by the speed; the cabin kept low", () => {
  const { sat, tat } = airTemperatures(0, 0);
  near(sat, 15, 0.01);
  near(tat, 15, 0.01);
  const high = airTemperatures(11_000, 0.78);
  near(high.sat, -56.5, 0.2);
  assert.ok(high.tat > high.sat + 20);
  // At the top of the climb, FL410, as high as the cabin goes.
  const cabin = cabinOf(12_500, 0);
  near(cabin.altitude, 8000, 1);
  assert.equal(cabin.verticalSpeed, 0);
  assert.ok(cabin.deltaP > 7 && cabin.deltaP < 9, `ΔP ${cabin.deltaP}`);
  // Climbing low down, the cabin climbs a fifth as fast.
  near(cabinOf(1000, 10).verticalSpeed, 10 * 0.2 * FEET * 60, 0.01);
});

/* ---- warnings ---- */

const calm: EcamInput = {
  warnings: [], brake: false, throttle: 0.7, turbulence: 0, altitude: 9000, radarAltitude: 8000, gear: 0, autopilotLost: false,
};

test("quiet flight: no warning, no master light, the no smoking memo only", () => {
  const ecam = ecamOf(calm);
  assert.deepEqual(ecam.warnings, []);
  assert.equal(ecam.masterWarning, false);
  assert.equal(ecam.masterCaution, false);
  assert.deepEqual(ecam.memo.map((line) => line.text), ["NO SMOKING"]);
});

test("each warning is called in red and lights the master warning; the overspeed with the aircraft's own limits", () => {
  for (const warning of ["stall", "overspeed", "terrain"]) {
    const ecam = ecamOf({ ...calm, warnings: [warning] });
    assert.equal(ecam.warnings[0].colour, "red", warning);
    assert.equal(ecam.masterWarning, true, warning);
    assert.equal(ecam.masterCaution, false, warning);
  }
  const limits = ecamOf({ ...calm, warnings: ["overspeed"] }).warnings[1].text;
  assert.ok(limits.endsWith(`${Math.round(VMO_MS * KNOTS)}/.${Math.round(MMO * 100)}`), limits);
  assert.equal(ecamOf({ ...calm, autopilotLost: true }).warnings[0].text, "AUTO FLT AP OFF");
});

test("ice, or a warning the display does not know, is a caution: amber, and the master caution, after the warnings", () => {
  const ecam = ecamOf({ ...calm, warnings: ["ice", "stall", "something"] });
  assert.deepEqual(ecam.warnings.map((line) => line.colour), ["red", "amber", "amber"]);
  assert.equal(ecam.warnings[2].text, "SOMETHING");
  assert.equal(ecam.masterWarning, true);
  assert.equal(ecam.masterCaution, true);
});

test("memos: the seat belts in rough air and low down, the speed brake amber with thrust on, the gear when landing", () => {
  assert.ok(ecamOf({ ...calm, turbulence: 0.5 }).memo.some((line) => line.text === "SEAT BELTS"));
  assert.ok(ecamOf({ ...calm, altitude: 2000 }).memo.some((line) => line.text === "SEAT BELTS"));
  assert.equal(ecamOf({ ...calm, brake: true, throttle: 0 }).memo.at(-1)!.colour, "green");
  assert.equal(ecamOf({ ...calm, brake: true, throttle: 0.6 }).memo.at(-1)!.colour, "amber");
  const up = ecamOf({ ...calm, radarAltitude: 300, gear: 0 }).memo[0];
  const down = ecamOf({ ...calm, radarAltitude: 300, gear: 1 }).memo[0];
  assert.equal(up.colour, "cyan");
  assert.equal(down.colour, "green");
  assert.ok(!ecamOf({ ...calm, radarAltitude: null }).memo.some((line) => line.text.startsWith("LDG")));
});

test("lights: a flashing one half on, half off; the gear's red while moving, green once down", () => {
  assert.equal(flashOn(0.1), true);
  assert.equal(flashOn(0.3), false);
  assert.equal(flashOn(1.1), true);
  assert.deepEqual(gearLights(0), { unlocked: false, down: false });
  assert.deepEqual(gearLights(0.5), { unlocked: true, down: false });
  assert.deepEqual(gearLights(1), { unlocked: false, down: true });
});

/* ---- the autopilot's windows ---- */

test("the windows show the primary flight display's numbers: speed, heading, altitude, vertical speed", () => {
  const windows = fcuOf({ ias: 150, mach: 0.5, heading: 87.4, altitude: 3000, verticalSpeed: 5, held: null });
  assert.equal(windows.mach, false);
  assert.equal(windows.speed, String(Math.round(150 * KNOTS)));
  assert.equal(windows.heading, "087");
  assert.equal(windows.altitude, String(Math.round((3000 * FEET) / 100) * 100).padStart(5, "0"));
  assert.equal(windows.verticalSpeed, `+${String(Math.round((5 * FEET * 60) / 100)).padStart(2, "0")}00`);
  assert.equal(fcuOf({ ias: 150, mach: 0.5, heading: 359.7, altitude: 3000, verticalSpeed: -10, held: null }).heading, "000");
  assert.ok(fcuOf({ ias: 150, mach: 0.5, heading: 0, altitude: 3000, verticalSpeed: -10, held: null }).verticalSpeed.startsWith("-"));
});

test("with the autopilot on, the altitude it holds and no vertical speed; up high, the Mach number as the PFD reads it", () => {
  const held = fcuOf({ ias: 140, mach: 0.78, heading: 10, altitude: 9500, verticalSpeed: 0.3, held: 9500 });
  assert.equal(held.altitude, String(Math.round((9500 * FEET) / 10) * 10));
  assert.equal(held.verticalSpeed, "-----");
  assert.equal(held.mach, (9500 * FEET) >= MACH_ABOVE_FT);
  assert.equal(held.speed, ".78");
  // The PFD's Mach is .786 here; the window has its first two figures, not .79.
  assert.equal(fcuOf({ ias: 140, mach: 0.7864, heading: 10, altitude: 10_000, verticalSpeed: 0, held: null }).speed, ".78");
});

test("the altimeter setting: standard above the transition altitude, the standard day's below", () => {
  assert.equal(baroOf(10_000), "Std");
  assert.equal(baroOf(500), "1013");
});

/* ---- the keyboards' pages ---- */

test("the flight plan page: the storm's bearing, distance and time, and when it is reached", () => {
  const now = Date.UTC(2026, 10, 19, 19, 50, 0);
  const page = flightPlanPage({
    altitude: 7315, ias: 150, now, scan: Date.UTC(2026, 10, 19, 19, 45),
    target: { bearing: 87.2, distance: 64 * 1852, seconds: 539, peakDbz: 53.4 },
  });
  assert.equal(page.title, "F-PLN");
  assert.equal(page.rows[0].line[1], `${Math.round(150 * KNOTS)}/${flightLevel(7315)}`);
  assert.equal(page.rows[1].label[0], "BRG087°");
  assert.equal(page.rows[1].line[0], "WX 53DBZ");
  assert.equal(page.rows[1].line[1], "1958");
  assert.equal(page.rows[2].line[0], "64NM");
  assert.equal(page.rows[2].line[1], "8:59");
  assert.equal(page.rows[3].line[0], "1945");
  const clear = flightPlanPage({ altitude: 7315, ias: 150, now, scan: null, target: null });
  assert.equal(clear.rows[1].line[0], "NO WX AHEAD");
  assert.equal(clear.rows[2].line[0], "----");
});

test("the progress page and its small formats", () => {
  const page = progressPage({ altitude: 11_000, tas: 230, groundSpeed: 229, mach: 0.78, fuelUsed: 1234 });
  assert.equal(page.rows[0].line[0], flightLevel(11_000));
  assert.equal(page.rows[0].line[1], ".780");
  assert.equal(page.rows[1].line[1], String(Math.round(230 * KNOTS)));
  assert.equal(page.rows[3].line[0], "1230KG");
  assert.equal(flightLevel(7315), "FL240");
  assert.equal(minutesSeconds(539.9), "8:59");
  assert.equal(minutesSeconds(-3), "0:00");
  assert.equal(utc(Date.UTC(2026, 0, 1, 7, 5)), "0705");
});

/* ---- where they are ---- */

const normalOf = (quad: Quad) => {
  const a = quad[1].map((v, i) => v - quad[0][i]);
  const b = quad[3].map((v, i) => v - quad[0][i]);
  return [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
};

test("every screen and light faces the seat, so none is drawn back to front, and is mirrored the right way round", () => {
  const quads: Array<[string, Quad]> = [
    ...Object.entries(COCKPIT_SCREENS),
    ...Object.entries(COCKPIT_LIGHTS).flatMap(([name, lights]) => lights.map((light, i) => [`${name} ${i}`, light.corners] as [string, Quad])),
  ];
  for (const [name, quad] of quads) {
    const normal = normalOf(quad);
    const towards = SEAT.map((v, i) => v - quad[0][i]);
    assert.ok(normal.reduce((sum, v, i) => sum + v * towards[i], 0) > 0, `${name} faces away from the seat`);
    // Left to right across: the picture is not mirrored.
    assert.ok(quad[1][1] > quad[0][1], `${name} runs right to left`);
  }
  const mirror = mirrored(COCKPIT_SCREENS.pfd);
  near(mirror[0][1], -COCKPIT_SCREENS.pfd[1][1], 1e-9);
});

test("a lifted quad stands off its face towards the seat, and a part of one keeps within it", () => {
  const quad: Quad = [[1, -1, -1], [1, 1, -1], [0, 1, 0], [0, -1, 0]];
  const up = lifted(quad, 0.01);
  const moved = up[0].map((v, i) => v - quad[0][i]);
  near(Math.hypot(...moved), 0.01, 1e-9);
  // Towards where this face is looked at from: aft and above.
  assert.ok(moved[0] < 0 && moved[2] < 0);
  const half = partOf(quad, 0, 0.5, 1, 1);
  assert.deepEqual(half[0], [0.5, -1, -0.5]);
  assert.deepEqual(half[2], quad[2]);
});

/* ---- a hand on the controls ---- */

const CONTROLS = Object.entries(COCKPIT_CONTROLS) as Array<[CockpitControlName, CockpitControl]>;
/** A point of a face: so far across and down it, and so far off it, as a share of what stands on it: its top, unless said. */
const pointOf = ({ corners, height }: ControlFace, across: number, down: number, off = 1): Vec3 => (
  partOf(lifted(corners, height * off), across, down, across, down)[0]
);
const from = (point: Vec3): Vec3 => [point[0] - SEAT[0], point[1] - SEAT[1], point[2] - SEAT[2]];

test("every control faces the seat, and a look at the middle of each of its faces meets it and no other", () => {
  for (const [name, control] of CONTROLS) {
    control.faces.forEach((face, index) => {
      const normal = normalOf(face.corners);
      const towards = SEAT.map((v, i) => v - face.corners[0][i]);
      assert.ok(normal.reduce((sum, v, i) => sum + v * towards[i], 0) > 0, `${name} ${index} faces away from the seat`);
      const pick = controlAlong(SEAT, from(pointOf(face, 0.5, 0.5)));
      assert.equal(pick?.name, name);
      assert.equal(pick?.face, index);
      // Within reach of the seat, all of them, the pedals at a leg's length.
      assert.ok(pick!.distance > 0.3 && pick!.distance < 1.5, `${name} is ${pick!.distance} m off`);
    });
    assert.ok((control.press === undefined) !== (control.hold === undefined), `${name} is clicked or held, one of the two`);
  }
});

test("a control is picked where it is drawn: a point of the picture, looked along, meets the control seen there", () => {
  const [fov, aspect] = [28, 1440 / 900];
  for (const [name, control] of CONTROLS) {
    control.faces.forEach((face, index) => {
      const offset = from(pointOf(face, 0.5, 0.5));
      // The head turned most of the way to it: the control off the middle of the picture.
      const head = {
        heading: (Math.atan2(offset[1], offset[0]) * 180) / Math.PI + 4,
        pitch: (Math.atan2(-offset[2], Math.hypot(offset[0], offset[1])) * 180) / Math.PI - 3,
        roll: 0,
      };
      // The same point ten times as far off is at the same place in the picture.
      const at = seenFrom(head, offset.map((v) => v * 10) as Vec3, fov, aspect);
      assert.ok(at && at.x > 0 && at.x < 1 && at.y > 0 && at.y < 1, `${name} is out of the picture`);
      const pick = controlAlong(SEAT, lookedAlong(head, at.x, at.y, fov, aspect));
      assert.equal(pick?.name, name);
      assert.equal(pick?.face, index);
    });
  }
});

test("where on a face it is pointed at: the flap lever's forward half and its aft half, a pedal for each foot", () => {
  const [flaps] = COCKPIT_CONTROLS.flaps.faces;
  const forward = controlAlong(SEAT, from(pointOf(flaps, 0.3, 0.2, 0)))!;
  const aft = controlAlong(SEAT, from(pointOf(flaps, 0.3, 0.8, 0)))!;
  assert.equal(forward.name, "flaps");
  near(forward.down, 0.2, 0.01);
  near(aft.down, 0.8, 0.01);
  near(aft.across, 0.3, 0.01);
  assert.deepEqual(COCKPIT_CONTROLS.flaps.press, ["flapsIn", "flapsOut"]);
  const [left, right] = COCKPIT_CONTROLS.pedals.faces;
  assert.ok(left.corners[0][1] < right.corners[0][1]);
  assert.deepEqual([left.push, right.push], [-1, 1]);
});

test("no control is met out of the windows, from behind, or by a look past its edge", () => {
  assert.equal(controlAlong(SEAT, [1, 0, -0.05]), null);
  assert.equal(controlAlong(SEAT, [-1, 0, 0.2]), null);
  // From under the pedestal, looking up through the flap lever: its back.
  const [flaps] = COCKPIT_CONTROLS.flaps.faces;
  const under = pointOf(flaps, 0.5, 0.5, -20);
  assert.equal(controlAlong(under, [0, 0, -1])?.name, undefined);
  // Just short of the gear lever's panel, on the seat's side of it, and just onto it.
  const [gear] = COCKPIT_CONTROLS.gear.faces;
  assert.equal(controlAlong(SEAT, from(pointOf(gear, -0.3, 0.5, 0)))?.name, undefined);
  assert.equal(controlAlong(SEAT, from(pointOf(gear, 0.1, 0.5, 0)))?.name, "gear");
});

/* ---- the same by a key and by a gamepad ---- */

test("whatever a control of the flight deck is clicked for, a key does and a gamepad's button does", () => {
  const KEYS = ["KeyU", "KeyJ", "KeyB", "KeyG", "KeyL", "KeyX", "KeyK", "KeyO"];
  const byKey = new Set(KEYS.map((code) => actionOf(code)));
  const buttons = Array.from({ length: 17 }, () => ({ pressed: true }));
  const byPad = new Set(gamepadActions(buttons, []));
  for (const [name, control] of CONTROLS) {
    for (const action of [control.press ?? []].flat() as FlightAction[]) {
      assert.ok(byKey.has(action), `no key for ${name}'s ${action}`);
      // The radar's colours on the ground are the map's, not the aircraft's: a key's and the panel's only.
      if (action !== "radar") assert.ok(byPad.has(action), `no gamepad button for ${name}'s ${action}`);
    }
  }
  assert.equal(actionOf("KeyX"), "autobrake");
  assert.equal(actionOf("KeyK"), "parkingBrake");
  assert.ok(isFlightKey("KeyK") && isFlightKey("KeyX"));
});

test("a gamepad's button does its action once a press: as it goes down, not while it is held", () => {
  const pad = (...down: number[]) => Array.from({ length: 17 }, (_unused, index) => ({ pressed: down.includes(index) }));
  const held = (buttons: Array<{ pressed: boolean }>) => buttons.map((button) => button.pressed);
  // Up and down on the pad are the flaps in and out, as U and J are; X and Y the speed brake and the gear.
  assert.deepEqual(gamepadActions(pad(13), []), ["flapsOut"]);
  assert.deepEqual(gamepadActions(pad(12), held(pad())), ["flapsIn"]);
  assert.deepEqual(gamepadActions(pad(13), held(pad(13))), []);
  assert.deepEqual(gamepadActions(pad(2, 3, 13), held(pad(13))), ["speedbrake", "gear"]);
  assert.deepEqual(gamepadActions(pad(14, 15), []), ["autobrake", "parkingBrake"]);
  assert.deepEqual(gamepadActions(pad(10), []), ["autopilot"]);
  // The ones that fly are held, and do nothing once: the brake, the bumpers, the triggers.
  assert.deepEqual(gamepadActions(pad(1, 4, 5, 6, 7), []), []);
  // A pad with fewer buttons than the standard layout has none of the rest.
  assert.deepEqual(gamepadActions([{ pressed: false }, { pressed: false }, { pressed: true }], []), ["speedbrake"]);
});
