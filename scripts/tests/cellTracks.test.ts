import assert from "node:assert/strict";
import test from "node:test";
import { distanceKm, lastRunStart, MAX_STORM_KMH } from "../../src/lib/cellGeometry.ts";

/**
 * Where a track stops being one storm.
 *
 * The upstream identity is DWD's cell number, which is reused across unrelated
 * cells, so a stale detection is sometimes glued onto a new cell that inherits
 * it. Nothing about the result looks broken in the data -- every field is
 * populated and plausible on its own -- and on the map it is a straight line a
 * few hundred kilometres long joining two storms with nothing to do with each
 * other. These are the four real cases from one run, with their own numbers.
 */

const at = (minutes: number, lon: number, lat: number) => ({
  t: new Date(Date.UTC(2026, 8, 20, 8, minutes)).toISOString(),
  lon,
  lat,
});

test("kilometres between two points shrink with latitude, as longitude does", () => {
  // A degree of longitude is about 111 km at the equator and 69 at 52N.
  assert.ok(Math.abs(distanceKm([10, 0], [11, 0]) - 111.32) < 0.5);
  assert.ok(Math.abs(distanceKm([10, 52], [11, 52]) - 68.5) < 1);
  // A degree of latitude does not.
  assert.ok(Math.abs(distanceKm([10, 52], [10, 53]) - 111.32) < 0.5);
});

test("an ordinary track is not cut anywhere", () => {
  const steps = Array.from({ length: 12 }, (_, i) => at(i * 5, 11 + i * 0.05, 48 + i * 0.03));

  assert.equal(lastRunStart(steps), 0);
});

/**
 * The fastest genuine step in a real run implied 144 km/h -- a single cell
 * covering 12 km in five minutes. The ceiling has to sit above that or the
 * quickest real storms lose their history.
 */
test("a fast but real storm keeps its whole track", () => {
  const steps = [at(0, 11, 48), at(5, 11.16, 48.06), at(10, 11.32, 48.12)];

  steps.slice(1).forEach((step, i) => {
    const kmh = distanceKm([steps[i].lon, steps[i].lat], [step.lon, step.lat]) * 12;
    assert.ok(kmh > 130 && kmh < MAX_STORM_KMH, `${kmh} km/h is the case being tested`);
  });
  assert.equal(lastRunStart(steps), 0);
});

/** 12:10 near Stuttgart, 13:10 near Dresden: 434 km, and a different cell. */
test("a track that teleports is cut at the jump", () => {
  const steps = [at(130, 11.5, 48.18), at(190, 15.25, 51.23)];

  assert.equal(lastRunStart(steps), 1);
});

test("only the run after the last jump survives", () => {
  const steps = [
    at(0, 12.71, 48.78),
    at(40, 14.83, 51.07), // the glued join
    at(45, 14.89, 51.09),
    at(50, 14.95, 51.11),
  ];

  assert.equal(lastRunStart(steps), 1);
});

test("a later jump wins over an earlier one", () => {
  const steps = [at(0, 9, 48), at(5, 9.05, 48.02), at(10, 15, 52), at(15, 15.05, 52.02)];

  assert.equal(lastRunStart(steps), 2);
});

/**
 * A long gap is not by itself a jump. A cell can go undetected for a few scans
 * -- hidden behind a stronger echo, or below the threshold -- and come back
 * where it should be, and that history is real.
 */
test("a gap in detection is not a jump if the cell is where it should be", () => {
  const steps = [at(0, 11, 48), at(40, 11.6, 48.3)];

  assert.equal(lastRunStart(steps), 0);
});

/**
 * Timestamps are not guaranteed to be ordered or distinct, and dividing by the
 * gap between two of them is how this decides. A duplicate timestamp would
 * make every pair infinitely fast and cut every track down to its last step.
 */
test("a repeated timestamp does not read as infinite speed", () => {
  const steps = [at(0, 11, 48), at(0, 11.4, 48.2), at(5, 11.5, 48.25)];

  assert.equal(lastRunStart(steps), 0);
});

test("a track of one step has nothing to cut", () => {
  assert.equal(lastRunStart([at(0, 11, 48)]), 0);
  assert.equal(lastRunStart([]), 0);
});
