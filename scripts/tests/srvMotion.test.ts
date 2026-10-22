import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSpeed, compassPoint, DEFAULT_MANUAL_MOTION, editBase, formatManualMotion, headingFromPoint, MAX_SPEED_KMH,
  motionOfManual, parseManualMotion, resolveMotion, sameManualMotion, snapHeading, stepSpeed, turnHeading,
} from "../../src/lib/srvMotion.ts";
import { stormRelative } from "../../src/lib/sweepGeometry.ts";

test("a finger on the dial points the way it is from the centre, clockwise from north", () => {
  // Screen y grows downward: up is north.
  assert.equal(headingFromPoint(0, -40), 0);
  assert.equal(headingFromPoint(40, 0), 90);
  assert.equal(headingFromPoint(0, 40), 180);
  assert.equal(headingFromPoint(-40, 0), 270);
  assert.equal(headingFromPoint(30, -30), 45);
  assert.equal(headingFromPoint(-30, 30), 225);
});

test("the dial snaps to five degrees, and just west of north is north", () => {
  assert.equal(headingFromPoint(10, -100), 5);
  assert.equal(headingFromPoint(-1, -100), 0);
  assert.equal(snapHeading(357.6), 0);
  assert.equal(snapHeading(-92), 270);
  assert.equal(snapHeading(722), 0);
});

test("the dial's centre points nowhere", () => {
  assert.equal(headingFromPoint(0, 0), null);
});

test("an arrow key turns the heading a click, round past north either way", () => {
  assert.equal(turnHeading(355, 1), 0);
  assert.equal(turnHeading(0, -1), 355);
  assert.equal(turnHeading(45, 9), 90);
});

test("the stepper goes in fives, from wherever a typed speed left it", () => {
  assert.equal(stepSpeed(0, 1), 5);
  assert.equal(stepSpeed(43, 1), 45);
  assert.equal(stepSpeed(43, -1), 40);
  assert.equal(stepSpeed(45, 1), 50);
  assert.equal(stepSpeed(45, -1), 40);
});

test("speed stays between standing still and the stepper's top", () => {
  assert.equal(stepSpeed(0, -1), 0);
  assert.equal(stepSpeed(MAX_SPEED_KMH, 1), MAX_SPEED_KMH);
  assert.equal(clampSpeed(-3), 0);
  assert.equal(clampSpeed(999), MAX_SPEED_KMH);
  assert.equal(clampSpeed(37.6), 38);
  assert.equal(clampSpeed(Number.NaN), 0);
});

test("the setting keeps a manual motion as heading and km/h, and reads it back", () => {
  const motion = { headingDeg: 240, speedKmh: 55 };
  assert.equal(formatManualMotion(motion), "240,55");
  assert.deepEqual(parseManualMotion("240,55"), motion);
  assert.ok(sameManualMotion(parseManualMotion(formatManualMotion(motion)), motion));
});

test("a setting it cannot read is the default; one out of range is brought in", () => {
  for (const value of ["", "north", "45", "45,", ",30", "a,b", "1,2,3", null, undefined, 7, true]) {
    assert.deepEqual(parseManualMotion(value), DEFAULT_MANUAL_MOTION, String(value));
  }
  assert.deepEqual(parseManualMotion("400,-3"), { headingDeg: 40, speedKmh: 0 });
  assert.deepEqual(parseManualMotion(" 92 , 999 "), { headingDeg: 90, speedKmh: MAX_SPEED_KMH });
});

test("before one is set, nothing is taken out", () => {
  assert.equal(motionOfManual(DEFAULT_MANUAL_MOTION).speedMs, 0);
  assert.equal(stormRelative(12, 45, motionOfManual(DEFAULT_MANUAL_MOTION)), 12);
});

test("a manual motion is taken out in m/s", () => {
  const motion = motionOfManual({ headingDeg: 90, speedKmh: 36 });
  assert.equal(motion.speedMs, 10);
  assert.equal(motion.headingDeg, 90);
  // A storm going east at 10 m/s: a 10 m/s outbound wind east of the radar
  // is the storm's own motion, the same wind west of it is 20 faster than
  // the storm, and across the motion nothing changes.
  assert.ok(Math.abs(stormRelative(10, 90, motion)) < 1e-9);
  assert.ok(Math.abs(stormRelative(10, 270, motion) - 20) < 1e-9);
  assert.ok(Math.abs(stormRelative(-4, 0, motion) + 4) < 1e-9);
});

test("SRV takes the selected storm's motion, unless the reader asked for their own", () => {
  const storm = { speedMs: 12.5, headingDeg: 60 };
  const manual = { headingDeg: 200, speedKmh: 18 };
  assert.deepEqual(resolveMotion(storm, manual, false), { source: "storm", motion: storm });
  assert.deepEqual(resolveMotion(storm, manual, true), { source: "manual", motion: { speedMs: 5, headingDeg: 200 } });
});

test("with no storm, or one that does not say how it moves, SRV takes the manual motion", () => {
  const manual = { headingDeg: 200, speedKmh: 18 };
  assert.deepEqual(resolveMotion(null, manual, false), { source: "manual", motion: { speedMs: 5, headingDeg: 200 } });
});

test("turning the dial while it shows a storm's motion starts from the storm's", () => {
  const manual = { headingDeg: 200, speedKmh: 18 };
  const fromStorm = resolveMotion({ speedMs: 15.1, headingDeg: 62.3 }, manual, false);
  assert.deepEqual(editBase(fromStorm, manual), { headingDeg: 60, speedKmh: 54 });
  assert.equal(editBase(resolveMotion(null, manual, false), manual), manual);
});

test("a heading is worded as the nearest of sixteen points", () => {
  assert.equal(compassPoint(0), "N");
  assert.equal(compassPoint(11), "N");
  assert.equal(compassPoint(12), "NNE");
  assert.equal(compassPoint(45), "NE");
  assert.equal(compassPoint(60), "ENE");
  assert.equal(compassPoint(180), "S");
  assert.equal(compassPoint(350), "N");
  assert.equal(compassPoint(-90), "W");
});
