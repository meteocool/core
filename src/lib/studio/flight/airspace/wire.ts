/**
 * What the meteoair board API's airspace sends and takes, on its socket at
 * `<API origin>/v3/air/airspace`: JSON in text frames, and little-endian
 * binary frames for where the aircraft are.
 *
 * The cockpit sends its own aircraft's state, 36 bytes, as often as the
 * airspace asks (`encodeState`); the airspace sends snapshots of the
 * aircraft near it, 8 bytes and 36 for each aircraft (`readSnapshot`). A
 * state's last eight bytes are its `look` (look.ts), which the airspace
 * passes on untouched.
 *
 * Nothing in either is trusted as it comes: a frame of the wrong length or
 * kind is let go of, and a number out of its range is held to it.
 */

/** A state's bytes, and an aircraft's in a snapshot; and a snapshot's head. */
export const STATE_BYTES = 36;
export const SNAPSHOT_HEAD_BYTES = 8;
export const LOOK_BYTES = 8;

/** The first byte of each binary frame: a state, a snapshot. */
export const STATE_KIND = 1;
export const SNAPSHOT_KIND = 2;

/** The flags' bits: on the ground, gear down, paused, the clock running fast. */
export const ON_GROUND = 1;
export const GEAR_DOWN = 2;
export const PAUSED = 4;
export const WARPED = 8;

/** An age this large (in 10 ms) is that or more. */
export const AGE_MOST = 255;

/** The airspace's numbers, as `joined` gives them. */
export interface AirspaceLimits {
  send_hz_most: number;
  frames_per_s_most: number;
  near: number;
  near_m: number;
  near_hz: number;
  far: number;
  far_m: number;
  far_every_ms: number;
  silent_ms: number;
}

/** Until the airspace has said its own. */
export const DEFAULT_LIMITS: AirspaceLimits = {
  send_hz_most: 5, frames_per_s_most: 8, near: 32, near_m: 25_000, near_hz: 5, far: 200, far_m: 20_100_000, far_every_ms: 2000, silent_ms: 10_000,
};

/** The text frames the airspace sends. */
export type AirspaceMessage =
  | { type: "joined"; id: number; callsign: string; send_hz: number; limits: Partial<AirspaceLimits> }
  | { type: "rate"; send_hz: number }
  | { type: "names"; names: Record<string, string> }
  | { type: "ended" };

/** A text frame, read: null for anything that is not one of the airspace's. */
export function readMessage(data: string): AirspaceMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  const { type } = message as { type?: unknown };
  if (type === "joined" || type === "rate" || type === "names" || type === "ended") return message as AirspaceMessage;
  return null;
}

/** The limits a `joined` gives, each number taken only where it is one. */
export function limitsOf(given: unknown): AirspaceLimits {
  const limits = { ...DEFAULT_LIMITS };
  if (!given || typeof given !== "object") return limits;
  for (const key of Object.keys(limits) as Array<keyof AirspaceLimits>) {
    const value = (given as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) limits[key] = value;
  }
  return limits;
}

/** What the cockpit says of its aircraft. */
export interface OwnState {
  flags: number;
  lon: number;
  lat: number;
  /** True metres above the sea. */
  altitude: number;
  /** Over the ground, m/s, as flown now. */
  east: number;
  north: number;
  up: number;
  /** Degrees: true, clockwise from north; nose up; right wing down. */
  heading: number;
  pitch: number;
  roll: number;
  /** Eight bytes; see look.ts. */
  look: Uint8Array;
}

const clampInt = (value: number, low: number, high: number) => (Number.isFinite(value) ? Math.min(Math.max(Math.round(value), low), high) : 0);
const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const wrap180 = (degrees: number) => wrap360(degrees + 180) - 180;

/** `state` as its 36 bytes, counted `counter`, into `out` (which is reused frame after frame). */
export function encodeState(state: OwnState, counter: number, out: DataView = new DataView(new ArrayBuffer(STATE_BYTES))): DataView {
  out.setUint8(0, STATE_KIND);
  out.setUint8(1, state.flags & 0x0f);
  out.setUint16(2, counter & 0xffff, true);
  out.setInt32(4, clampInt(wrap180(state.lon) * 1e7, -1_800_000_000, 1_800_000_000), true);
  out.setInt32(8, clampInt(state.lat * 1e7, -900_000_000, 900_000_000), true);
  out.setInt32(12, clampInt(state.altitude * 100, -(2 ** 31), 2 ** 31 - 1), true);
  out.setInt16(16, clampInt(state.east * 10, -32768, 32767), true);
  out.setInt16(18, clampInt(state.north * 10, -32768, 32767), true);
  out.setInt16(20, clampInt(state.up * 10, -32768, 32767), true);
  out.setUint16(22, Math.round((wrap360(state.heading) / 360) * 65536) & 0xffff, true);
  out.setInt16(24, clampInt(state.pitch * 100, -9000, 9000), true);
  out.setInt16(26, clampInt(wrap180(state.roll) * 100, -18000, 18000), true);
  for (let i = 0; i < LOOK_BYTES; i += 1) out.setUint8(28 + i, state.look[i] ?? 0);
  return out;
}

/** An aircraft of a snapshot, as `readSnapshot` hands each over: the same object every time, so copy what is kept. */
export interface HeardAircraft {
  id: number;
  flags: number;
  /** How old its state was when the snapshot was sent, ms; `AGE_MOST` tens of them for that or more. */
  ageMs: number;
  lon: number;
  lat: number;
  altitude: number;
  east: number;
  north: number;
  up: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Its eight bytes of `look`, a view into the frame: read them before the next aircraft. */
  look: Uint8Array;
}

/**
 * A snapshot: its clock (the airspace's, ms, wrapping at 2^32), and each
 * aircraft in it handed to `each` in turn. The number of aircraft the frame
 * says it holds and the number it has room for must agree; a frame that is
 * not a snapshot, or not a whole one, is let go of. How many were read, or
 * -1 for a frame let go of.
 */
export function readSnapshot(
  frame: ArrayBuffer, each: (aircraft: HeardAircraft, clock: number) => void, into: HeardAircraft = blankHeard(),
): number {
  if (frame.byteLength < SNAPSHOT_HEAD_BYTES) return -1;
  const view = new DataView(frame);
  if (view.getUint8(0) !== SNAPSHOT_KIND) return -1;
  const count = view.getUint16(2, true);
  if (frame.byteLength !== SNAPSHOT_HEAD_BYTES + count * STATE_BYTES) return -1;
  const clock = view.getUint32(4, true);
  const bytes = new Uint8Array(frame);
  for (let i = 0; i < count; i += 1) {
    const at = SNAPSHOT_HEAD_BYTES + i * STATE_BYTES;
    into.id = view.getUint16(at, true);
    into.flags = view.getUint8(at + 2) & 0x0f;
    into.ageMs = view.getUint8(at + 3) * 10;
    into.lon = view.getInt32(at + 4, true) / 1e7;
    into.lat = Math.min(Math.max(view.getInt32(at + 8, true) / 1e7, -85), 85);
    into.altitude = Math.min(Math.max(view.getInt32(at + 12, true) / 100, -500), 30_000);
    into.east = view.getInt16(at + 16, true) / 10;
    into.north = view.getInt16(at + 18, true) / 10;
    into.up = view.getInt16(at + 20, true) / 10;
    into.heading = (view.getUint16(at + 22, true) / 65536) * 360;
    into.pitch = Math.min(Math.max(view.getInt16(at + 24, true) / 100, -90), 90);
    into.roll = wrap180(view.getInt16(at + 26, true) / 100);
    into.look = bytes.subarray(at + 28, at + 36);
    each(into, clock);
  }
  return count;
}

export function blankHeard(): HeardAircraft {
  return { id: 0, flags: 0, ageMs: 0, lon: 0, lat: 0, altitude: 0, east: 0, north: 0, up: 0, heading: 0, pitch: 0, roll: 0, look: new Uint8Array(LOOK_BYTES) };
}

/**
 * A snapshot made of aircraft, as the airspace would send it: for the
 * synthetic sky, and for tests. Each aircraft is a state's bytes 4 to 35
 * with an id, flags and an age before them.
 */
export function writeSnapshot(clock: number, aircraft: ReadonlyArray<{ id: number; ageMs: number; state: OwnState }>): ArrayBuffer {
  const buffer = new ArrayBuffer(SNAPSHOT_HEAD_BYTES + aircraft.length * STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, SNAPSHOT_KIND);
  view.setUint8(1, 0);
  view.setUint16(2, aircraft.length, true);
  view.setUint32(4, clock >>> 0, true);
  const scratch = new DataView(new ArrayBuffer(STATE_BYTES));
  const bytes = new Uint8Array(buffer);
  aircraft.forEach(({ id, ageMs, state }, i) => {
    const at = SNAPSHOT_HEAD_BYTES + i * STATE_BYTES;
    encodeState(state, 0, scratch);
    bytes.set(new Uint8Array(scratch.buffer, 4, 32), at + 4);
    view.setUint16(at, id & 0xffff, true);
    view.setUint8(at + 2, state.flags & 0x0f);
    view.setUint8(at + 3, Math.min(AGE_MOST, Math.max(0, Math.round(ageMs / 10))));
  });
  return buffer;
}

/** The socket's address: the API's host, ws(s) for http(s); a relative base is the page's own host. */
export function airspaceUrl(boardBase: string, page: { protocol: string; host: string }): string {
  const url = new URL(`${boardBase}/airspace`, `${page.protocol}//${page.host}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
