/**
 * `look`: the eight bytes at the end of each state the cockpit sends the
 * airspace, which it passes on to every cockpit near untouched. What an
 * aircraft shows to someone outside it, besides where it is and how it is
 * turned: what is out of it, what has come off it, what burns, and what
 * blew up, and when.
 *
 * Version 1, byte by byte:
 *
 * | Byte | What |
 * | --- | --- |
 * | 0 | the version: 1 |
 * | 1 | low four bits: the flaps, 0 in to 15 all the way out; high four: the spoilers, 0 flat to 15 all the way up |
 * | 2 | bit 0 the left wing gone, bit 1 the right wing, bit 2 the tail, bit 3 a control surface or more; bits 4 to 6 the crash (`CrashKind`); bit 7 nought |
 * | 3 | what burns, a bit each (`FIRE_PLACES`): the hull's middle, its aft, the left engine, the right, the left wing's root, the right's, the tail's |
 * | 4 | how hard the strongest of those burns, 0 to 255 |
 * | 5 | the seed the newest blast's fireball is drawn from |
 * | 6 | how large the newest blast is, metres across; 0 for none |
 * | 7 | how long ago the newest blast went off, tenths of a second; 255 for 25.5 s or longer, or none |
 *
 * So a viewer who first hears of an aircraft after its blast went off
 * draws that blast as far on as it is, or not at all once it is over, and
 * never starts it again.
 *
 * A version this cockpit does not know (an older one's, a newer one's) is
 * an aircraft with nothing wrong with it: drawn whole, nothing burning.
 */
import type { Damage } from "../damage";
import { FLAPS_MOST } from "../physics";
import type { AircraftState } from "../physics";
import { BREAKS } from "../model";
import { BLAST_FROM, broken } from "../damage";

export const LOOK_VERSION = 1;

/**
 * How the flight ended, as seen from outside: not at all; sliding to a
 * stop; blown up where it hit; broken up in the air, and falling.
 */
export type CrashKind = "none" | "slid" | "blew" | "broke";
const CRASH_KINDS: readonly CrashKind[] = ["none", "slid", "blew", "broke"];

/** Where a fire burns on the aircraft (metres forward, right, down, from its middle), how large it is there, metres across. */
export const FIRE_PLACES: ReadonlyArray<{ at: [number, number, number]; size: number }> = [
  { at: [1, 0, 0.6], size: 8 },
  { at: [-9, 0, 0.4], size: 5 },
  { at: [2.1, -6.2, 2.55], size: 3 },
  { at: [2.1, 6.2, 2.55], size: 3 },
  { at: [-0.5, -BREAKS.wingRoot, 0.9], size: 5 },
  { at: [-0.5, BREAKS.wingRoot, 0.9], size: 5 },
  { at: [BREAKS.tail, 0, -0.4], size: 4 },
];

/** A look read: what to draw of an aircraft besides where it is. */
export interface Look {
  /** 0 to 1 each. */
  flaps: number;
  spoilers: number;
  lost: { leftWing: boolean; rightWing: boolean; tail: boolean; surfaces: boolean };
  crash: CrashKind;
  /** Of `FIRE_PLACES`, a bit each; and how hard the strongest burns, 0 to 1. */
  burning: number;
  strength: number;
  /** The newest blast: its seed, how large (metres across), how long ago, seconds; null for none, or one too long ago to matter. */
  blast: { seed: number; size: number; ago: number } | null;
}

export const INTACT: Readonly<Look> = Object.freeze({
  flaps: 0, spoilers: 0, lost: Object.freeze({ leftWing: false, rightWing: false, tail: false, surfaces: false }), crash: "none",
  burning: 0, strength: 0, blast: null,
}) as Look;

/** A blank look to read into, kept by its aircraft. */
export function blankLook(): Look {
  return { flaps: 0, spoilers: 0, lost: { leftWing: false, rightWing: false, tail: false, surfaces: false }, crash: "none", burning: 0, strength: 0, blast: null };
}

const nibble = (share: number) => Math.min(15, Math.max(0, Math.round((Number.isFinite(share) ? share : 0) * 15)));

/** What the cockpit says to encode: the look as `Look` has it. */
export function encodeLook(look: Look, out: Uint8Array = new Uint8Array(8)): Uint8Array {
  out.fill(0);
  out[0] = LOOK_VERSION;
  out[1] = nibble(look.flaps) | (nibble(look.spoilers) << 4);
  const crash = Math.max(0, CRASH_KINDS.indexOf(look.crash));
  out[2] = (look.lost.leftWing ? 1 : 0) | (look.lost.rightWing ? 2 : 0) | (look.lost.tail ? 4 : 0) | (look.lost.surfaces ? 8 : 0) | (crash << 4);
  out[3] = look.burning & 0x7f;
  out[4] = look.burning ? Math.min(255, Math.max(0, Math.round(look.strength * 255))) : 0;
  const blast = look.blast;
  if (blast && blast.size > 0 && blast.ago < 25.5) {
    out[5] = blast.seed & 0xff;
    out[6] = Math.min(255, Math.max(1, Math.round(blast.size)));
    out[7] = Math.min(254, Math.max(0, Math.floor(blast.ago * 10)));
  } else {
    out[7] = 255;
  }
  return out;
}

/**
 * Eight bytes read into `into` (and answered), defensively: anything short
 * of eight bytes, or of a version this cockpit does not know, is an intact
 * aircraft.
 */
export function decodeLook(bytes: ArrayLike<number>, into: Look = blankLook()): Look {
  const known = bytes.length >= 8 && bytes[0] === LOOK_VERSION;
  const b = (i: number) => (known ? bytes[i] & 0xff : 0);
  into.flaps = (b(1) & 0x0f) / 15;
  into.spoilers = (b(1) >> 4) / 15;
  const lost = b(2);
  into.lost.leftWing = Boolean(lost & 1);
  into.lost.rightWing = Boolean(lost & 2);
  into.lost.tail = Boolean(lost & 4);
  into.lost.surfaces = Boolean(lost & 8);
  into.crash = CRASH_KINDS[(lost >> 4) & 0x07] ?? "none";
  into.burning = b(3) & 0x7f;
  into.strength = into.burning ? b(4) / 255 : 0;
  const size = b(6);
  const ago = known ? b(7) : 255;
  if (size > 0 && ago < 255) {
    into.blast ??= { seed: 0, size: 0, ago: 0 };
    into.blast.seed = b(5);
    into.blast.size = size;
    into.blast.ago = ago / 10;
  } else {
    into.blast = null;
  }
  return into;
}

/** The place of `FIRE_PLACES` nearest a point, on the side the fire's piece is. */
function placeOf(on: string, at: readonly number[]): number {
  if (on === "leftWing") return 4;
  if (on === "rightWing") return 5;
  if (on === "tail") return 6;
  let best = 0;
  let nearest = Infinity;
  FIRE_PLACES.forEach((place, i) => {
    const d = Math.hypot(place.at[0] - at[0], place.at[1] - at[1], place.at[2] - at[2]);
    if (d < nearest) {
      nearest = d;
      best = i;
    }
  });
  return best;
}

/** The cockpit's own aircraft as a look: from its state and what has happened to its airframe (damage.ts). */
export function lookOf(state: Pick<AircraftState, "flaps" | "spoilers" | "crash">, damage: Readonly<Damage>, into: Look = blankLook()): Look {
  into.flaps = state.flaps / FLAPS_MOST;
  into.spoilers = state.spoilers;
  into.lost.leftWing = Boolean(damage.lost.leftWing);
  into.lost.rightWing = Boolean(damage.lost.rightWing);
  into.lost.tail = Boolean(damage.lost.tail);
  into.lost.surfaces = Boolean(damage.lost.surfaces?.length);
  into.crash = state.crash
    ? damage.violence !== null && damage.violence >= BLAST_FROM ? "blew" : "slid"
    : broken(damage) ? "broke" : "none";
  let burning = 0;
  let strength = 0;
  for (const fire of damage.fires) {
    const left = fire.fades === undefined ? 1 : Math.max(0, 1 - (damage.clock - fire.born) / fire.fades);
    const now = fire.strength * left;
    if (now < 0.05) continue;
    burning |= 1 << placeOf(fire.on, fire.at);
    strength = Math.max(strength, Math.min(1, now));
  }
  into.burning = burning;
  into.strength = strength;
  let newest: Damage["blasts"][number] | null = null;
  for (const blast of damage.blasts) if (!newest || blast.born >= newest.born) newest = blast;
  if (newest) {
    into.blast ??= { seed: 0, size: 0, ago: 0 };
    into.blast.seed = (damage.seed * 31 + damage.blasts.length * 7) & 0xff;
    into.blast.size = newest.size;
    into.blast.ago = Math.max(0, damage.clock - newest.born);
  } else {
    into.blast = null;
  }
  return into;
}
