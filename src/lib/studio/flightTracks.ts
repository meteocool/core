/**
 * The flights flown in this browser, as tracks over the ground: drawn on the
 * radar map (layers/flightTracks.ts), and taken off from again where they
 * left off or where they began (components/FlightTrackCard.svelte).
 *
 * Kept in this browser's localStorage and nowhere else, and only for as long
 * as they are shown: a track fades from the map over two hours, its oldest
 * part first, and what has faded is gone from storage too.
 *
 * Each track holds two moments of its flight, as a link shared in flight
 * would (lib/studio/snapshot.ts): the one it took off from and the last one
 * flown, which is never the wreck of a crash but a moment before it.
 *
 * Free of the flight's code, which records into it
 * (lib/studio/flight/trackRecorder.ts), so the map can draw the tracks
 * without fetching any of it.
 */
import { get, writable } from "svelte/store";
import type { FlightSnapshot } from "./snapshot";
import type { FlightStart } from "./flightLink";

/** How long a track is shown after it was flown, ms: each part of it fades over this long, and is gone after. */
export const TRACK_SHOWN_MS = 2 * 60 * 60 * 1000;

/** The localStorage key the tracks are kept under. */
export const TRACKS_KEY = "meteoair.tracks";

/** As many tracks as are kept, newest first, and as many points in each: an hour's flight sampled every two seconds, and more. */
const MOST_TRACKS = 24;
const MOST_POINTS = 4000;

/** A place the aircraft passed: longitude and latitude, degrees; altitude, metres above the sea; and when, ms since the epoch. */
export type TrackPoint = [lon: number, lat: number, altitude: number, at: number];

export interface FlightTrack {
  id: string;
  /**
   * The track in pieces: a new piece wherever the flight jumped (to the next
   * storm, or back to its start), so no line is drawn across the jump.
   */
  legs: TrackPoint[][];
  /** The moment it took off from, and the last moment flown, for "fly again" and "resume". */
  first: FlightSnapshot;
  last: FlightSnapshot;
  /** Whether the flight ended in a crash: `last` is then a moment before it. */
  crashed: boolean;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const part = (snapshot: FlightSnapshot, key: string): Record<string, unknown> => {
  const value = snapshot[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

/** The newest point of a track; null for one with none. */
export function lastPoint(track: FlightTrack): TrackPoint | null {
  for (let leg = track.legs.length - 1; leg >= 0; leg--) {
    const points = track.legs[leg];
    if (points.length) return points[points.length - 1];
  }
  return null;
}

/** The oldest point of a track; null for one with none. */
export function firstPoint(track: FlightTrack): TrackPoint | null {
  for (const leg of track.legs) if (leg.length) return leg[0];
  return null;
}

/** When a track was last flown, ms since the epoch; 0 for one with no points. */
export const flownAt = (track: FlightTrack): number => lastPoint(track)?.[3] ?? 0;

/**
 * How much of a part of a track flown at `at` is still shown at `now`: 1
 * when just flown, down to 0 two hours on. Eased, so a track stays clear for
 * most of the first hour and goes in the second.
 */
export function shownFraction(at: number, now: number): number {
  const age = Math.min(Math.max((now - at) / TRACK_SHOWN_MS, 0), 1);
  return 1 - age * age;
}

/**
 * The tracks with what has faded taken out: points older than two hours, the
 * pieces left empty and the tracks with nothing left; newest first, and only
 * as many as are kept.
 */
export function pruned(tracks: readonly FlightTrack[], now: number): FlightTrack[] {
  const since = now - TRACK_SHOWN_MS;
  return tracks
    .map((track) => {
      if (track.legs.every((leg) => leg.every((point) => point[3] >= since))) return track;
      return { ...track, legs: track.legs.map((leg) => leg.filter((point) => point[3] >= since)).filter((leg) => leg.length > 0) };
    })
    .filter((track) => track.legs.some((leg) => leg.length > 0))
    .sort((one, other) => flownAt(other) - flownAt(one))
    .slice(0, MOST_TRACKS);
}

const isPoint = (value: unknown): value is TrackPoint => Array.isArray(value) && value.length === 4 && value.every(finite);
const isObject = (value: unknown): value is FlightSnapshot => value !== null && typeof value === "object" && !Array.isArray(value);

/** Tracks as stored, back; whatever is not one, or not one any more, left out. */
export function readTracks(text: string | null, now: number): FlightTrack[] {
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const tracks = value.flatMap((item): FlightTrack[] => {
    if (!isObject(item) || typeof item.id !== "string" || !Array.isArray(item.legs) || !isObject(item.first) || !isObject(item.last)) return [];
    const legs = item.legs.filter(Array.isArray).map((leg: unknown[]) => leg.filter(isPoint));
    return [{ id: item.id, legs, first: item.first, last: item.last, crashed: item.crashed === true }];
  });
  return pruned(tracks, now);
}

/**
 * Where to take off from to fly a moment of a track again: the aircraft
 * where it was then, as it pointed, as high and as fast, with the whole
 * moment for the flight to put back (lib/studio/flight/plan.ts, `resumedPlan`).
 * Null for a moment that says nowhere.
 */
export function startFrom(snapshot: FlightSnapshot): FlightStart | null {
  const where = part(snapshot, "where");
  const state = part(snapshot, "state");
  const lon = finite(state.lon) ? state.lon : where.lon;
  const lat = finite(state.lat) ? state.lat : where.lat;
  if (!finite(lon) || !finite(lat)) return null;
  const altitude = finite(state.altitude) ? state.altitude : finite(where.altitude) ? where.altitude : null;
  return {
    lon, lat,
    heading: finite(state.heading) ? state.heading : null,
    altitude,
    speed: finite(where.ias) && where.ias > 0 ? { knots: where.ias * 1.943844 } : null,
    view: snapshot.view === "cockpit" ? "cockpit" : "outside",
    snapshot,
  };
}

/** How far a track goes over the ground, metres, its jumps left out. */
export function trackLength(track: FlightTrack): number {
  let metres = 0;
  for (const leg of track.legs) {
    for (let index = 1; index < leg.length; index++) metres += groundDistance(leg[index - 1], leg[index]);
  }
  return metres;
}

/** The highest a track went, metres above the sea; null for one with no points. */
export function highestOf(track: FlightTrack): number | null {
  let highest: number | null = null;
  for (const leg of track.legs) for (const point of leg) highest = highest === null ? point[2] : Math.max(highest, point[2]);
  return highest;
}

/** Metres between two points over the ground, near enough for a few seconds' flight. */
export function groundDistance(one: TrackPoint | [number, number], other: TrackPoint | [number, number]): number {
  const toRad = Math.PI / 180;
  const x = (other[0] - one[0]) * toRad * Math.cos(((one[1] + other[1]) / 2) * toRad);
  const y = (other[1] - one[1]) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}

/* The tracks, as the map and the flight share them. */

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

function load(): FlightTrack[] {
  try {
    return readTracks(storage()?.getItem(TRACKS_KEY) ?? null, Date.now());
  } catch {
    return [];
  }
}

/** The tracks shown, newest first. */
export const flightTracks = writable<FlightTrack[]>(load());

/** The track tapped on the map, and where it was tapped (lon, lat), for its card; null when none is. */
export const selectedFlightTrack = writable<{ id: string; at: [number, number] } | null>(null);

function save(tracks: FlightTrack[]): void {
  try {
    const kept = storage();
    if (!kept) return;
    if (tracks.length) kept.setItem(TRACKS_KEY, JSON.stringify(tracks));
    else kept.removeItem(TRACKS_KEY);
  } catch {
    // Full, or not allowed: the track is still drawn for as long as this page is up.
  }
}

function change(update: (tracks: FlightTrack[]) => FlightTrack[]): void {
  const next = pruned(update(get(flightTracks)), Date.now());
  flightTracks.set(next);
  save(next);
  const selected = get(selectedFlightTrack);
  if (selected && !next.some((track) => track.id === selected.id)) selectedFlightTrack.set(null);
}

/** Begin a track, at the moment taken off from; returns its id. */
export function beginTrack(first: FlightSnapshot, at: TrackPoint): string {
  const id = `${at[3].toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  change((tracks) => [{ id, legs: [[at]], first, last: first, crashed: false }, ...tracks]);
  return id;
}

/** A track flown from its start again: what was flown of it before is let go, and it begins again at `at`. Returns whether there was such a track. */
export function restartTrack(id: string, at: TrackPoint): boolean {
  let found = false;
  change((tracks) => tracks.map((track) => {
    if (track.id !== id) return track;
    found = true;
    return { ...track, legs: [[at]], last: track.first, crashed: false };
  }));
  return found;
}

/**
 * Points flown since, onto a track: onto its last piece, or onto a new one
 * (`newLeg`, after a jump); and the moment flown last, where there is a new
 * one. `crashed` once the flight has. Returns whether there was such a track.
 */
export function extendTrack(
  id: string, points: readonly TrackPoint[], update: { last?: FlightSnapshot; newLeg?: boolean; crashed?: boolean } = {},
): boolean {
  let found = false;
  change((tracks) => tracks.map((track) => {
    if (track.id !== id) return track;
    found = true;
    let legs = track.legs.map((leg) => leg);
    if (points.length) {
      if (update.newLeg || !legs.length) legs.push([...points]);
      else legs[legs.length - 1] = [...legs[legs.length - 1], ...points];
    }
    // The oldest points go first past the most kept: a very long flight's start fades out early.
    let count = legs.reduce((sum, leg) => sum + leg.length, 0);
    while (count > MOST_POINTS && legs.length) {
      const over = count - MOST_POINTS;
      if (legs[0].length <= over) {
        count -= legs[0].length;
        legs = legs.slice(1);
      } else {
        legs[0] = legs[0].slice(over);
        count -= over;
      }
    }
    return { ...track, legs, last: update.last ?? track.last, crashed: update.crashed ?? track.crashed };
  }));
  return found;
}

/** Take a track off the map, and out of storage. */
export function deleteTrack(id: string): void {
  change((tracks) => tracks.filter((track) => track.id !== id));
}

/** Let go of what has faded since; the map calls this now and then. */
export function pruneTracks(): void {
  const before = get(flightTracks);
  const after = pruned(before, Date.now());
  if (after.length === before.length && after.every((track, index) => track === before[index])) return;
  change(() => after);
}

/* A flight in another tab of this browser (the flight's own page, say) draws its track here as it goes. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== TRACKS_KEY && event.key !== null) return;
    flightTracks.set(load());
    const selected = get(selectedFlightTrack);
    if (selected && !get(flightTracks).some((track) => track.id === selected.id)) selectedFlightTrack.set(null);
  });
}
