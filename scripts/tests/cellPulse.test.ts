import assert from "node:assert/strict";
import test from "node:test";
import {
  DASH, DASH_PERIOD, ENDED_MIN_ZOOM, isLive, LIVE_MINUTES, NOTCH_DEGREES, RING_PATH_LENGTH, RING_RADIUS, TICK_MS, onlySlid,
  ringAngle, showsEnded,
} from "../../src/lib/cellPulse.ts";

/**
 * The ring that marks a live cell, stepping round it a notch at a time.
 *
 * It replaced an expanding-and-fading ping that rebuilt every live cell's
 * style twenty times a second and visibly failed to keep up with a hundred of
 * them on screen. Here the ring never changes shape: it only turns, a notch at
 * a time, which the compositor can animate without the page.
 */
test("a cycle is one dash and one gap, nine notches", () => {
  assert.equal(DASH_PERIOD, DASH[0] + DASH[1]);
  const angles = new Set();
  for (let ms = 0; ms < TICK_MS * DASH_PERIOD * 3; ms += 10) angles.add(ringAngle(ms));
  assert.equal(angles.size, DASH_PERIOD);
});

test("the pattern closes round the ring, so the turn loops without a jump", () => {
  // A whole number of dash periods round the path: no stub where it joins.
  assert.equal(RING_PATH_LENGTH % DASH_PERIOD, 0);
  // Close to the circle's own length, so the dashes keep their size.
  assert.ok(Math.abs(RING_PATH_LENGTH / (2 * Math.PI * RING_RADIUS) - 1) < 0.05);
  // A cycle turns the ring by exactly one dash period, which looks like none.
  assert.equal((DASH_PERIOD * NOTCH_DEGREES * RING_PATH_LENGTH) / 360, DASH_PERIOD);
});

test("it holds still between ticks rather than sweeping", () => {
  // The step is the point: smooth rotation at this size reads as a shimmer,
  // a notch reads as a mechanism running.
  assert.equal(ringAngle(0), ringAngle(TICK_MS - 1));
  assert.notEqual(ringAngle(0), ringAngle(TICK_MS));
});

test("the dashes travel the way the pattern is read", () => {
  // Clockwise, which CSS spells as a positive angle; the other way looks like
  // the ring running backwards.
  for (let tick = 1; tick < DASH_PERIOD; tick += 1) {
    assert.ok(ringAngle(tick * TICK_MS) > ringAngle((tick - 1) * TICK_MS));
  }
});

test("every live cell steps together, off one clock", () => {
  // A map where each cell runs its own cycle shimmers; one shared beat reads
  // as the map itself being live.
  assert.equal(ringAngle(1_000_000), ringAngle(1_000_000));
  assert.equal(ringAngle(0), ringAngle(TICK_MS * DASH_PERIOD));
});

/**
 * Which cells the ping marks.
 *
 * The obvious candidate was the schema's own `active` -- "whether the cell was
 * still being detected recently". On the live backend it is true for every
 * track returned: 200 of 200 in one response, 147 of those last detected more
 * than fifteen minutes before the run's own reference time. It does not
 * separate the live storms from the stopped ones, so the timestamp does.
 */
test("a cell detected in the newest run is live", () => {
  assert.equal(isLive(0), true);
});

test("one missed detection does not take a live storm off the map", () => {
  // DWD's cadence is five-minutely, so a cell seen two runs ago is a cell that
  // missed one -- common, and not the same as a storm that has stopped.
  assert.equal(isLive(5), true);
  assert.equal(isLive(LIVE_MINUTES), true);
});

test("a cell that has stopped being detected stops pinging", () => {
  assert.equal(isLive(LIVE_MINUTES + 0.1), false);
  assert.equal(isLive(85), false);
});

/**
 * The rings slide together while the map only pans, and are laid out afresh
 * whenever the zoom, the turn or the cells change: a pan moves every ring by
 * the same amount, anything else moves each by its own.
 */
test("a pan slides the rings together; anything else lays them out again", () => {
  const laid = { resolution: 611.5, rotation: 0, revision: 7 };
  assert.equal(onlySlid(laid, { ...laid }), true);
  assert.equal(onlySlid(laid, { ...laid, resolution: 600 }), false, "a zoom");
  assert.equal(onlySlid(laid, { ...laid, rotation: 0.1 }), false, "a turn");
  assert.equal(onlySlid(laid, { ...laid, revision: 8 }), false, "a cell added, removed or moved");
  assert.equal(onlySlid(null, laid), false, "nothing laid out yet");
});

test("cells no longer detected are drawn from zoom 10 in, not from a country away", () => {
  const atZoom = (zoom: number) => 156_543.033_928_041 / 2 ** zoom;
  assert.equal(ENDED_MIN_ZOOM, 10);
  assert.ok(showsEnded(atZoom(11)));
  assert.ok(showsEnded(atZoom(10)));
  assert.ok(!showsEnded(atZoom(9.5)));
  assert.ok(!showsEnded(atZoom(6)));
});
