/**
 * A flight's track, recorded as it is flown (lib/studio/flightTracks.ts):
 * where the aircraft is every couple of seconds flown, and the whole moment
 * every few, for the radar map to draw and take off from again.
 *
 * A new track for a flight taken off from anywhere but the map's tracks; a
 * track taken off from again goes on, from where it left off or, flown from
 * its start, in place of what was flown of it before.
 */
import { get } from "svelte/store";
import { flightStatus } from "../store";
import { beginTrack, extendTrack, groundDistance, restartTrack } from "../flightTracks";
import type { TrackPoint } from "../flightTracks";
import type { Pilot } from "./pilot";

/** A track to go on with, and from where: its last moment, or its start. */
export interface TrackAsked {
  id: string;
  from: "last" | "start";
}

/** How often a point is taken, and the whole moment, in seconds flown; and how often what is taken is written down, at most. */
const POINT_S = 2;
const MOMENT_S = 5;
const WRITE_S = 5;
/** Nearer than this to the last point, m, and there is no new one: the aircraft at a stop. */
const STILL_M = 25;
/** Further than this from the last point in one sample, m, and the flight has jumped: a new piece of track. */
const JUMP_M = 15_000;

/** Record the flight `pilot` flies, onto the track asked for or a new one; returns how to stop, which writes down the rest. */
export function recordTrack(pilot: Pilot, asked: TrackAsked | null): () => void {
  let id: string | null = null;
  let pending: TrackPoint[] = [];
  let newLeg = false;
  let previous: TrackPoint | null = null;
  let pointAt = -Infinity;
  let momentAt = -Infinity;
  let writtenAt = -Infinity;
  let moment: ReturnType<Pilot["snapshot"]> | null = null;
  let crashed = false;
  let crashWritten = false;

  const pointNow = (): TrackPoint => {
    const { lon, lat, altitude } = pilot.telemetry.state;
    return [lon, lat, altitude, Date.now()];
  };

  const write = () => {
    if (id === null) return;
    if (!pending.length && !moment && crashed === crashWritten) return;
    const kept = extendTrack(id, pending, { last: moment ?? undefined, newLeg, crashed });
    crashWritten = crashed;
    pending = [];
    newLeg = false;
    moment = null;
    // Deleted from the map while flown: the rest of the flight is a track of its own.
    if (!kept) id = null;
  };

  const begin = () => {
    const at = pointNow();
    previous = at;
    if (asked?.from === "start" && restartTrack(asked.id, at)) id = asked.id;
    else if (asked?.from === "last" && extendTrack(asked.id, [at], { newLeg: true, crashed: false })) id = asked.id;
    else id = beginTrack(pilot.snapshot(), at);
    asked = null;
  };

  const off = pilot.onFrame((telemetry) => {
    if (id === null) {
      begin();
      if (id === null) return;
    }
    const time = telemetry.time;
    const wrecked = Boolean(telemetry.state.crash) || get(flightStatus).crash !== null;
    // A wreck flown again (`restart`) is not one any more.
    crashed = wrecked;
    if (time - pointAt >= POINT_S) {
      pointAt = time;
      const at = pointNow();
      const away = previous ? groundDistance(previous, at) : Infinity;
      if (away > JUMP_M) {
        // Jumped: what was taken before goes down with its own piece, and this starts the next.
        write();
        newLeg = true;
        pending.push(at);
        previous = at;
      } else if (away >= STILL_M || Math.abs(at[2] - (previous?.[2] ?? at[2])) >= STILL_M) {
        pending.push(at);
        previous = at;
      }
    }
    // Never the wreck: the moment resumed from is the last one before it.
    if (!wrecked && time - momentAt >= MOMENT_S) {
      momentAt = time;
      moment = pilot.snapshot();
    }
    if (time - writtenAt >= WRITE_S) {
      writtenAt = time;
      write();
    }
  });

  const away = () => write();
  window.addEventListener("pagehide", away);

  return () => {
    off();
    window.removeEventListener("pagehide", away);
    if (id !== null && !crashed) {
      pending.push(pointNow());
      moment = pilot.snapshot();
    }
    write();
  };
}
