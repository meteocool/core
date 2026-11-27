/**
 * The other aircraft the airspace says are near, each where it is to be
 * drawn now.
 *
 * Each aircraft keeps the last few states heard of it, each placed on the
 * airspace's clock (the snapshot's clock less the state's age). It is drawn
 * a little in the past, between the two states either side of that moment:
 * so far back that the next state has usually come by the time it is
 * needed, which is further for one heard only every two seconds than for
 * one heard five times a second. How far back follows how often each is
 * heard, and changes slowly, so an aircraft coming near is not seen to
 * jump. With nothing newer, it is carried on along its velocity for a
 * second at most, then fades out, and is forgotten once nothing has been
 * heard of it for the airspace's `silent_ms`. One whose pilot has paused
 * stands where it is.
 *
 * The airspace's clock wraps at 2^32 ms (about seven weeks): it is
 * unwrapped here, step by step, and laid on the page's own clock by the
 * least delay a snapshot has been seen to take, which a late one does not
 * move.
 *
 * Nothing is made anew on a frame: each aircraft's numbers are written in
 * place, and `list` is the same array from frame to frame.
 */
import { blankLook, decodeLook } from "./look";
import type { Look } from "./look";
import { AGE_MOST, blankHeard, DEFAULT_LIMITS, PAUSED, readSnapshot } from "./wire";
import type { AirspaceLimits, HeardAircraft } from "./wire";

/** How many states each aircraft keeps. */
const KEPT = 4;
/** How far past its newest state an aircraft is carried on, and then how long it takes to fade out, ms. */
export const CARRY_MS = 1000;
export const FADE_MS = 1000;
/** How far back an aircraft is drawn: so many of its intervals and so much more, between the least and the most, ms. */
const DELAY_INTERVALS = 1.3;
const DELAY_SPARE_MS = 120;
const DELAY_LEAST_MS = 200;
const DELAY_MOST_MS = 3200;
/** How fast that changes: so many ms of it for each ms that passes. */
const DELAY_PACE = 0.25;
/** The fastest any aircraft is believed to go, m/s, over the ground and up or down: the clock running fast included. */
const FASTEST_MS = 1200;
const STEEPEST_MS = 400;
const METRES_PER_DEGREE = 111_195;

/** A state heard of an aircraft, on the airspace's clock unwrapped (ms). */
interface Heard {
  t: number;
  flags: number;
  lon: number;
  lat: number;
  altitude: number;
  east: number;
  north: number;
  up: number;
  heading: number;
  pitch: number;
  roll: number;
}

const blankState = (): Heard => ({ t: -Infinity, flags: 0, lon: 0, lat: 0, altitude: 0, east: 0, north: 0, up: 0, heading: 0, pitch: 0, roll: 0 });

/** An aircraft as it is drawn now: `advance` writes these. */
export interface Shown {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Its velocity over the ground, m/s. */
  east: number;
  north: number;
  up: number;
  flags: number;
  /** How much of it is seen, 0 to 1: it fades out once it has gone unheard for a while. */
  opacity: number;
}

export interface OtherAircraft {
  id: number;
  callsign: string;
  /** What else to draw of it, as its newest state says. */
  look: Look;
  shown: Shown;
  /** When it was last heard, on the page's clock, ms. */
  heardAt: number;
  /** When first heard, ms: a number of its own for what is drawn of it. */
  since: number;
  /** About how often it is heard, ms, and how far back it is drawn now, ms. */
  interval: number;
  delay: number;
  /** Whatever the drawing keeps of it between frames (its contrail, its fire's start); none of this module's. */
  drawn: unknown;
  /** The states heard, oldest first in the ring that starts at `first`; how many. */
  states: Heard[];
  first: number;
  count: number;
  evaluatedAt: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const angleBetween = (a: number, b: number, f: number) => a + wrap180(b - a) * f;

export class Traffic {
  /** Every aircraft heard of and not yet forgotten. The same array from frame to frame. */
  readonly list: OtherAircraft[] = [];
  private readonly byId = new Map<number, OtherAircraft>();
  private readonly names = new Map<number, string>();
  private limits: AirspaceLimits = DEFAULT_LIMITS;
  /** The airspace's clock unwrapped, as the last snapshot said it; and the page's clock less it, least seen. */
  private clock: number | null = null;
  private raw = 0;
  private offset: number | null = null;
  private offsetAt = 0;
  private readonly scratch: HeardAircraft = blankHeard();
  private hearingAt = 0;
  private hearingClock = 0;
  private readonly hearOne = (aircraft: HeardAircraft) => this.hearAircraft(aircraft);

  /** The aircraft with this number, while it is heard of; undefined once it has been forgotten. */
  get(id: number): OtherAircraft | undefined {
    return this.byId.get(id);
  }

  setLimits(limits: AirspaceLimits): void {
    this.limits = limits;
  }

  /** The callsigns of aircraft about to be heard of, by their ids. */
  name(names: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(names)) {
      const id = Number(key);
      if (!Number.isInteger(id) || typeof value !== "string") continue;
      const callsign = value.slice(0, 16);
      this.names.set(id, callsign);
      const known = this.byId.get(id);
      if (known) known.callsign = callsign;
    }
    // Ids are reused a minute after: kept for the ones heard, and a few more.
    if (this.names.size > 4 * (this.limits.near + this.limits.far)) {
      for (const id of this.names.keys()) if (!this.byId.has(id)) this.names.delete(id);
    }
  }

  /** A snapshot, binary, heard at `now` on the page's clock (ms). How many aircraft it held, or -1 for a frame let go of. */
  hear(frame: ArrayBuffer, now: number): number {
    if (frame.byteLength < 8) return -1;
    const clock = new DataView(frame).getUint32(4, true);
    if (new DataView(frame).getUint8(0) !== 2) return -1;
    this.hearingAt = now;
    this.hearingClock = this.unwrap(clock, now);
    return readSnapshot(frame, this.hearOne, this.scratch);
  }

  /** The airspace's clock, unwrapped; and the page's clock laid on it. */
  private unwrap(clock: number, now: number): number {
    if (this.clock === null) {
      this.clock = clock;
    } else {
      // The step from the last, as a signed 32-bit number: through the wrap, and back a little for one out of order.
      this.clock += (clock - this.raw) | 0;
    }
    this.raw = clock;
    const offset = now - this.clock;
    // The least delay seen, drifting up slowly in case the clocks part: a late snapshot does not move it.
    if (this.offset === null || offset < this.offset) this.offset = offset;
    else this.offset += Math.min(offset - this.offset, (now - this.offsetAt) * 0.002);
    this.offsetAt = now;
    return this.clock;
  }

  private hearAircraft(heard: HeardAircraft): void {
    const now = this.hearingAt;
    let aircraft = this.byId.get(heard.id);
    if (!aircraft) {
      aircraft = {
        id: heard.id, callsign: this.names.get(heard.id) ?? "", look: blankLook(),
        shown: {
          lon: heard.lon, lat: heard.lat, altitude: heard.altitude, heading: heard.heading, pitch: heard.pitch, roll: heard.roll,
          east: 0, north: 0, up: 0, flags: heard.flags, opacity: 0,
        },
        heardAt: now, since: now, interval: 0, delay: 0, drawn: null,
        states: Array.from({ length: KEPT }, blankState), first: 0, count: 0, evaluatedAt: now,
      };
      this.byId.set(heard.id, aircraft);
      this.list.push(aircraft);
    }
    const t = this.hearingClock - (heard.ageMs >= AGE_MOST * 10 ? AGE_MOST * 10 : heard.ageMs);
    const newest = aircraft.count ? aircraft.states[(aircraft.first + aircraft.count - 1) % KEPT] : null;
    aircraft.heardAt = now;
    // The same state again, in the next snapshot, or one older than the newest: nothing new.
    if (newest && t <= newest.t + 5) return;
    if (newest) {
      const gap = clamp(t - newest.t, 50, 5000);
      aircraft.interval = aircraft.interval ? aircraft.interval * 0.7 + gap * 0.3 : gap;
    }
    const slot = aircraft.count < KEPT ? (aircraft.first + aircraft.count) % KEPT : aircraft.first;
    if (aircraft.count < KEPT) aircraft.count += 1;
    else aircraft.first = (aircraft.first + 1) % KEPT;
    const state = aircraft.states[slot];
    state.t = t;
    state.flags = heard.flags;
    state.lon = heard.lon;
    state.lat = heard.lat;
    state.altitude = heard.altitude;
    const speed = Math.hypot(heard.east, heard.north);
    const slower = speed > FASTEST_MS ? FASTEST_MS / speed : 1;
    state.east = heard.east * slower;
    state.north = heard.north * slower;
    state.up = clamp(heard.up, -STEEPEST_MS, STEEPEST_MS);
    state.heading = heard.heading;
    state.pitch = heard.pitch;
    state.roll = heard.roll;
    decodeLook(heard.look, aircraft.look);
    // How far back it is drawn is set by its first two states, and moves slowly from there.
    if (aircraft.count <= 2) aircraft.delay = this.delayFor(aircraft);
  }

  /** How far back an aircraft heard so often is drawn, ms; one heard once only, as one heard as rarely as the far ones are. */
  private delayFor(aircraft: OtherAircraft): number {
    const interval = aircraft.interval || this.limits.far_every_ms;
    return clamp(interval * DELAY_INTERVALS + DELAY_SPARE_MS, DELAY_LEAST_MS, DELAY_MOST_MS);
  }

  /**
   * Every aircraft where it is to be drawn at `now` (the page's clock, ms),
   * written into its `shown`; and those not heard of for `silent_ms`
   * forgotten (`gone` hears each).
   */
  advance(now: number, gone?: (aircraft: OtherAircraft) => void): void {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const aircraft = this.list[i];
      if (now - aircraft.heardAt > this.limits.silent_ms) {
        this.forget(i);
        gone?.(aircraft);
        continue;
      }
      this.place(aircraft, now);
    }
  }

  private forget(index: number): void {
    const aircraft = this.list[index];
    this.byId.delete(aircraft.id);
    const last = this.list.pop()!;
    if (index < this.list.length) this.list[index] = last;
  }

  /** Forget every aircraft: a new flight, or the airspace let go of. */
  clear(gone?: (aircraft: OtherAircraft) => void): void {
    for (const aircraft of this.list) gone?.(aircraft);
    this.list.length = 0;
    this.byId.clear();
  }

  private place(aircraft: OtherAircraft, now: number): void {
    const { states, first, count, shown } = aircraft;
    if (!count || this.offset === null) {
      shown.opacity = 0;
      return;
    }
    // How far back it is drawn moves to where it should be at its own pace.
    const passed = clamp(now - aircraft.evaluatedAt, 0, 250);
    aircraft.evaluatedAt = now;
    const target = this.delayFor(aircraft);
    aircraft.delay += clamp(target - aircraft.delay, -passed * DELAY_PACE, passed * DELAY_PACE);
    const t = now - this.offset - aircraft.delay;
    const newest = states[(first + count - 1) % KEPT];
    const oldest = states[first];
    shown.flags = newest.flags;
    if (newest.flags & PAUSED) {
      copyState(shown, newest, 0);
      // Still, where it was last; fading only once it has gone unheard.
      shown.opacity = fadeAfter(now - aircraft.heardAt - aircraft.interval);
      return;
    }
    if (t >= newest.t) {
      // Past the newest: carried on along its velocity for a second at most, then fading out.
      const past = t - newest.t;
      copyState(shown, newest, Math.min(past, CARRY_MS) / 1000);
      shown.opacity = fadeAfter(past);
      return;
    }
    if (t <= oldest.t) {
      copyState(shown, oldest, 0);
      shown.opacity = 1;
      return;
    }
    let before = oldest;
    let after = newest;
    for (let k = 1; k < count; k += 1) {
      const next = states[(first + k) % KEPT];
      if (next.t > t) {
        after = next;
        before = states[(first + k - 1) % KEPT];
        break;
      }
    }
    const f = (t - before.t) / Math.max(after.t - before.t, 1);
    shown.lon = before.lon + wrap180(after.lon - before.lon) * f;
    shown.lat = before.lat + (after.lat - before.lat) * f;
    shown.altitude = before.altitude + (after.altitude - before.altitude) * f;
    shown.east = before.east + (after.east - before.east) * f;
    shown.north = before.north + (after.north - before.north) * f;
    shown.up = before.up + (after.up - before.up) * f;
    shown.heading = (angleBetween(before.heading, after.heading, f) + 360) % 360;
    shown.pitch = before.pitch + (after.pitch - before.pitch) * f;
    shown.roll = angleBetween(before.roll, after.roll, f);
    shown.opacity = 1;
  }
}

/** How much of an aircraft is seen this long past its newest state, ms. */
const fadeAfter = (past: number) => 1 - clamp((past - CARRY_MS) / FADE_MS, 0, 1);

/** `state`, carried on `seconds` along its velocity, into `shown`. */
function copyState(shown: Shown, state: Heard, seconds: number): void {
  const north = state.north * seconds;
  const east = state.east * seconds;
  shown.lat = clamp(state.lat + north / METRES_PER_DEGREE, -85, 85);
  shown.lon = wrap180(state.lon + east / (METRES_PER_DEGREE * Math.max(0.05, Math.cos((state.lat * Math.PI) / 180))));
  shown.altitude = state.altitude + state.up * seconds;
  shown.east = state.east;
  shown.north = state.north;
  shown.up = state.up;
  shown.heading = state.heading;
  shown.pitch = state.pitch;
  shown.roll = state.roll;
}
