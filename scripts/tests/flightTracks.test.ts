import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import {
  beginTrack, deleteTrack, extendTrack, flightTracks, pruned, readTracks, restartTrack, shownFraction, startFrom, trackLength, TRACK_SHOWN_MS,
} from "../../src/lib/studio/flightTracks.ts";
import type { FlightTrack, TrackPoint } from "../../src/lib/studio/flightTracks.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23, 12);
const moment = (lon: number, lat: number) => ({ v: 1, where: { lon, lat, altitude: 7000, ias: 150 }, state: { lon, lat, altitude: 7000, heading: 45, tas: 230 }, view: "outside" });
const track = (id: string, legs: TrackPoint[][]): FlightTrack => ({ id, legs, first: moment(10, 47), last: moment(11, 47.5), crashed: false });

test("a track fades out over two hours, staying clear for most of the first", () => {
  assert.equal(shownFraction(NOW, NOW), 1);
  assert.ok(shownFraction(NOW - 0.5 * HOUR, NOW) > 0.9);
  assert.ok(shownFraction(NOW - 1.5 * HOUR, NOW) < 0.5);
  assert.equal(shownFraction(NOW - 2 * HOUR, NOW), 0);
  assert.equal(shownFraction(NOW - 5 * HOUR, NOW), 0);
});

test("what is older than two hours goes: points, then pieces, then whole tracks; newest first", () => {
  const old = NOW - TRACK_SHOWN_MS - 1;
  const tracks = [
    track("gone", [[[10, 47, 7000, old], [10.1, 47, 7000, old]]]),
    track("half", [[[10, 47, 7000, old]], [[10, 47, 7000, old], [10.1, 47, 7000, NOW - HOUR]]]),
    track("new", [[[10, 47, 7000, NOW - 1000]]]),
  ];
  const kept = pruned(tracks, NOW);
  assert.deepEqual(kept.map((one) => one.id), ["new", "half"]);
  assert.deepEqual(kept[1].legs, [[[10.1, 47, 7000, NOW - HOUR]]]);
});

test("stored tracks are read back, and anything that is not one is left out", () => {
  const good = track("a", [[[10, 47, 7000, NOW - 1000], [10.01, 47, 7000, NOW]]]);
  const text = JSON.stringify([good, { id: 3 }, { id: "b", legs: [[[1, 2, "x", 4]]], first: {}, last: {} }, "junk"]);
  const read = readTracks(text, NOW);
  assert.deepEqual(read.map((one) => one.id), ["a"]);
  assert.deepEqual(readTracks("not json", NOW), []);
  assert.deepEqual(readTracks(null, NOW), []);
});

test("a moment is taken off from where it was, as it pointed, with the whole moment", () => {
  const start = startFrom(moment(11, 47.5));
  assert.ok(start);
  assert.equal(start.lon, 11);
  assert.equal(start.lat, 47.5);
  assert.equal(start.heading, 45);
  assert.equal(start.altitude, 7000);
  assert.ok(start.speed && "knots" in start.speed && Math.abs(start.speed.knots - 291.6) < 0.1);
  assert.equal(start.view, "outside");
  assert.ok(start.snapshot);
  assert.equal(startFrom({ v: 1 }), null);
});

test("a track's length leaves its jumps out", () => {
  // Two pieces a degree of latitude long each, a long way apart.
  const flown = track("a", [[[10, 47, 0, NOW], [10, 48, 0, NOW]], [[20, 47, 0, NOW], [20, 48, 0, NOW]]]);
  assert.ok(Math.abs(trackLength(flown) - 2 * 111_195) < 100);
});

test("a track is begun, flown on, flown again from its start and deleted", () => {
  const now = Date.now();
  const id = beginTrack(moment(10, 47), [10, 47, 7000, now]);
  assert.ok(extendTrack(id, [[10.01, 47, 7000, now + 2000]], { last: moment(10.01, 47) }));
  assert.ok(extendTrack(id, [[12, 47, 7000, now + 4000]], { newLeg: true, crashed: true }));
  let flown = get(flightTracks).find((one) => one.id === id);
  assert.ok(flown);
  assert.equal(flown.legs.length, 2);
  assert.equal(flown.legs[0].length, 2);
  assert.equal(flown.crashed, true);
  assert.equal((flown.last.where as { lon: number }).lon, 10.01);

  assert.ok(restartTrack(id, [10, 47, 7000, now + 6000]));
  flown = get(flightTracks).find((one) => one.id === id);
  assert.ok(flown);
  assert.deepEqual(flown.legs, [[[10, 47, 7000, now + 6000]]]);
  assert.equal(flown.crashed, false);
  assert.equal(flown.last, flown.first);

  deleteTrack(id);
  assert.equal(get(flightTracks).some((one) => one.id === id), false);
  assert.equal(extendTrack(id, [[10, 47, 7000, now]]), false);
});
