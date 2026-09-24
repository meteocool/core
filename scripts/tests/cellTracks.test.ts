import assert from "node:assert/strict";
import test from "node:test";
import {
  distanceKm, ellipseRing4326, labelStepMinutes, lastRunStart, leadingTip, leadLabel,
  MAX_STORM_KMH, OUTLINE_MAX_MINUTES, outlineIsCurrent, TRACK_MAX_MINUTES, trackIsCurrent,
} from "../../src/lib/cellGeometry.ts";

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

/**
 * When a cell leaves the map.
 *
 * The endpoint answers with three hours of tracks, and fading alone left a map
 * open for an afternoon covered in storms that had long since gone out.
 */
test("a cell that is still being detected is drawn", () => {
  assert.equal(trackIsCurrent(0), true);
  assert.equal(trackIsCurrent(10), true);
});

test("a cell missed for a few scans is still drawn", () => {
  assert.equal(trackIsCurrent(TRACK_MAX_MINUTES), true);
});

test("a cell that went out more than half an hour ago is gone", () => {
  assert.equal(TRACK_MAX_MINUTES, 30);
  assert.equal(trackIsCurrent(TRACK_MAX_MINUTES + 0.1), false);
  assert.equal(trackIsCurrent(180), false);
});

/**
 * When an outline stops meaning anything.
 *
 * The tracks endpoint answers with a three-hour window, so most of what comes
 * back has stopped being detected. The path and the centroid fade over that;
 * the outline did not, and it does not move either -- it is the shape DWD
 * contoured at one detection, pinned where that detection was. A cell that
 * dissipated an hour ago therefore kept a full-strength ring over radar with
 * nothing in it, which reads as the tracker having lost its storm.
 */
test("a freshly detected outline is drawn", () => {
  assert.equal(outlineIsCurrent(0), true);
  assert.equal(outlineIsCurrent(5), true);
});

test("an outline survives the first fade but not the second", () => {
  // ageOpacity's first step is 20 minutes: faded, still describing the storm.
  assert.equal(outlineIsCurrent(25), true);
  assert.equal(outlineIsCurrent(OUTLINE_MAX_MINUTES), true);
});

test("a half-hour-old outline is dropped rather than faded further", () => {
  assert.equal(outlineIsCurrent(OUTLINE_MAX_MINUTES + 0.1), false);
  // The window the endpoint answers with; the whole tail of it used to draw.
  assert.equal(outlineIsCurrent(180), false);
});

test("a storm at 60 km/h has left a half-hour-old outline well behind it", () => {
  // Which is the reason for the cutoff: the outline does not travel with the
  // track, so at the limit it is already this far from anything on the radar.
  const kmh = 60;
  assert.ok(kmh * (OUTLINE_MAX_MINUTES / 60) >= 15);
});

/**
 * Labelling the cone's rings with how far ahead they are.
 *
 * Twelve rings arrive, one every five minutes for an hour. All twelve are only
 * readable zoomed in far enough that the storm's motion has spread them out;
 * zoomed out they converge on the cell and a full set is a stack of text.
 */
test("every ring is labelled when the map is close enough to hold them", () => {
  assert.equal(labelStepMinutes(50), 5);
  assert.equal(labelStepMinutes(150), 5);
});

test("labels thin out as the map zooms away", () => {
  assert.equal(labelStepMinutes(151), 10);
  assert.equal(labelStepMinutes(301), 15);
  assert.equal(labelStepMinutes(601), 20);
});

test("every step divides the hour, so the outermost ring is always labelled", () => {
  // The horizon of the forecast is the one lead time that must never be the
  // one dropped: it is what says how far ahead any of this goes.
  for (const resolution of [50, 200, 400, 900, 5000]) {
    assert.equal(60 % labelStepMinutes(resolution), 0);
  }
});

/**
 * What the label actually says, which is a different clock from the one that
 * decides which rings carry one.
 */
const AT = Date.UTC(2026, 8, 22, 12, 0, 0);
const MIN = 60_000;

test("the label counts down from now, not from the scan", () => {
  // The ring is 15 minutes past the detection it was forecast from, but the
  // scan reached the map seven minutes ago, so the reader has eight.
  assert.equal(leadLabel(AT + 8 * MIN, 15, 50, AT), "+8 min");
});

test("the ingestion delay is whatever it is, not a round number", () => {
  // The point of the change: a sequence that reads +15/+30/+45 is stating the
  // pipeline's frame, and a reader acts on the number in front of them.
  const rings = [15, 30, 45, 60].map((lead) => leadLabel(AT + (lead - 7) * MIN, lead, 50, AT));
  assert.deepEqual(rings, ["+8 min", "+23 min", "+38 min", "+53 min"]);
});

test("a ring whose moment has passed loses its label", () => {
  assert.equal(leadLabel(AT - MIN, 15, 50, AT), null);
  assert.equal(leadLabel(AT, 15, 50, AT), null);
});

test("which rings are labelled is still decided on the forecast's own grid", () => {
  // Thinning on the countdown would pick a different, mostly empty set every
  // minute: the rings are five minutes apart in forecast time, not in
  // time-from-now.
  assert.equal(leadLabel(AT + 8 * MIN, 15, 400, AT), "+8 min");
  assert.equal(leadLabel(AT + 13 * MIN, 20, 400, AT), null);
  assert.equal(leadLabel(AT + 53 * MIN, 60, 400, AT), "+53 min");
});

test("a ring with no forecast time is not guessed at", () => {
  assert.equal(leadLabel(Number.NaN, 15, 50, AT), null);
  assert.equal(leadLabel(AT + MIN, Number.NaN, 50, AT), null);
});

/**
 * Which end of a ring the label goes on.
 *
 * DWD reports the major axis as a compass bearing, not a direction of travel,
 * so the ring is built from whichever of the two ends the feed happened to
 * send. The label belongs on the far one: the near end is where every ring
 * bunches up over the cell.
 */
test("the label goes on the end of the ring furthest from the cell", () => {
  const cell: [number, number] = [11, 48];
  const ring = ellipseRing4326(11.2, 48, 20, 20, 90);
  const tip = leadingTip(ring, cell);
  assert.ok(distanceKm(cell, tip) > distanceKm(cell, ring[0])
    || tip === ring[0]);
  // Whichever end it picked, it is the further of the two candidates.
  const opposite = ring[Math.floor((ring.length - 1) / 2)];
  assert.ok(distanceKm(cell, tip) >= distanceKm(cell, opposite));
  assert.ok(distanceKm(cell, tip) >= distanceKm(cell, ring[0]));
});

test("a bearing pointing back at the cell still labels the far end", () => {
  // Same ellipse, the bearing reported the other way round: 90 and 270 draw
  // the identical ring, and the answer must not depend on which arrived.
  const cell: [number, number] = [11, 48];
  const east = leadingTip(ellipseRing4326(11.2, 48, 20, 20, 90), cell);
  const west = leadingTip(ellipseRing4326(11.2, 48, 20, 20, 270), cell);
  assert.ok(Math.abs(east[0] - west[0]) < 1e-9);
  assert.ok(Math.abs(east[1] - west[1]) < 1e-9);
  // And it is downstream of the cell, not between the cell and the centroid.
  assert.ok(east[0] > 11.2);
});
