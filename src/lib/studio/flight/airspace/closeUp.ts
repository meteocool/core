/**
 * The close-up of a pilot picked from the pins over the other aircraft: a
 * small live picture of their aircraft on its card, from a camera a few
 * tens of metres behind and beside it that follows it wherever it goes.
 *
 * What the picture needs that is not drawing: where that camera stands
 * (`ChaseCamera`), what the aircraft shows of itself, as the cockpit's own
 * renderer takes it (`CloseUpLook`, from its `look` and its flags), and
 * which model it is drawn with (`ModelChoice`). Nothing here is made anew
 * on a frame. The card itself is card.ts's.
 */
import type { AircraftEffects, AircraftPiece, AircraftView } from "../../../../layers/aircraftRenderer";
import { FAN_EXPOSURE_S, FAN_SHOWN_DEG_S, fanSpeed } from "../model";
import { FIRE_PLACES } from "./look";
import type { OtherAircraft } from "./traffic";
import { GEAR_DOWN, ON_GROUND } from "./wire";

type Vec3 = [number, number, number];

/** The close-up's lens, degrees across its height; how far the camera stands from the aircraft, metres. */
export const CLOSE_UP_FOV = 30;
export const CLOSE_UP_M = 50;
/** Which way the camera looks: this far to the right of the aircraft's heading, and this far down, degrees. It stands behind and to its left. */
export const LOOK_YAW = 28;
export const LOOK_PITCH = -5;
/** How long the camera takes to come round after a turn, seconds: a turn is seen as one, not as the sky going round. */
export const FOLLOW_S = 1.1;

const RADIANS = Math.PI / 180;
const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export interface Attitude {
  heading: number;
  pitch: number;
  roll: number;
}

/** How the close-up's camera sees the aircraft this frame. */
export interface ChaseView {
  /** The aircraft's frame (forward, right, down) to the camera's, for WebGL: a 4x4, columns first, looking down -z with y up. */
  modelView: Float32Array;
  /** The world's north, east and down from the aircraft to the camera's, the same way. */
  worldView: Float32Array;
  /** The camera's forward, right and down in the world's north, east and down: a 3x3, columns first, as GLSL takes it. */
  turn: Float32Array;
  /** Towards the sun, in the aircraft's frame. */
  light: Vec3;
  /** Which way the camera looks, degrees. */
  heading: number;
}

export function blankChaseView(): ChaseView {
  return { modelView: new Float32Array(16), worldView: new Float32Array(16), turn: new Float32Array(9), light: [0, 0, -1], heading: 0 };
}

/**
 * A camera behind and to the left of an aircraft, level with the world (so
 * a bank, a climb or a dive is the aircraft's against the horizon, never the
 * horizon's), coming round after it as it turns.
 */
export class ChaseCamera {
  private heading: number | null = null;
  private readonly aircraft = new Float64Array(9);
  private readonly camera = new Float64Array(9);

  /** Start again: the next aircraft is looked at from behind at once. */
  reset(): void {
    this.heading = null;
  }

  /** Where the camera is after `dt` seconds more of `attitude`; `sun` is towards the sun, north, east and down. Into `out`. */
  follow(attitude: Attitude, dt: number, sun: Readonly<Vec3>, out: ChaseView): ChaseView {
    const target = attitude.heading + LOOK_YAW;
    if (this.heading === null || !Number.isFinite(this.heading)) this.heading = target;
    else this.heading += wrap180(target - this.heading) * (1 - Math.exp(-Math.max(dt, 0) / FOLLOW_S));
    this.heading = ((this.heading % 360) + 360) % 360;
    out.heading = this.heading;
    const a = rotationInto(attitude.heading, attitude.pitch, attitude.roll, this.aircraft);
    const c = rotationInto(this.heading, LOOK_PITCH, 0, this.camera);
    // The aircraft's frame to the camera's (forward, right, down), then to WebGL's: x right, y up, z back; the aircraft CLOSE_UP_M ahead.
    viewInto(c, a, out.modelView);
    viewInto(c, null, out.worldView);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) out.turn[column * 3 + row] = c[row * 3 + column];
    for (let i = 0; i < 3; i++) out.light[i] = a[i] * sun[0] + a[3 + i] * sun[1] + a[6 + i] * sun[2];
    return out;
  }
}

/** view.ts's `rotation`, rows, into `out`: a frame turned by a heading, a pitch and a roll to the world's north, east and down. */
function rotationInto(heading: number, pitch: number, roll: number, out: Float64Array): Float64Array {
  const ch = Math.cos(heading * RADIANS), sh = Math.sin(heading * RADIANS);
  const cp = Math.cos(pitch * RADIANS), sp = Math.sin(pitch * RADIANS);
  const cr = Math.cos(roll * RADIANS), sr = Math.sin(roll * RADIANS);
  out[0] = ch * cp; out[1] = ch * sp * sr - sh * cr; out[2] = ch * sp * cr + sh * sr;
  out[3] = sh * cp; out[4] = sh * sp * sr + ch * cr; out[5] = sh * sp * cr - ch * sr;
  out[6] = -sp; out[7] = cp * sr; out[8] = cp * cr;
  return out;
}

/** The camera's turn back on a frame's (the world's where `frame` is null), as view.ts's `eyeOf` lays it out for WebGL. */
function viewInto(camera: Float64Array, frame: Float64Array | null, out: Float32Array): void {
  for (let j = 0; j < 3; j++) {
    // Column j of the camera's transpose times the frame: the frame's axis j in the camera's forward, right and down.
    let forward = 0, right = 0, down = 0;
    for (let k = 0; k < 3; k++) {
      const f = frame ? frame[k * 3 + j] : k === j ? 1 : 0;
      forward += camera[k * 3] * f;
      right += camera[k * 3 + 1] * f;
      down += camera[k * 3 + 2] * f;
    }
    out[j * 4] = right;
    out[j * 4 + 1] = -down;
    out[j * 4 + 2] = -forward;
    out[j * 4 + 3] = 0;
  }
  out[12] = 0;
  out[13] = 0;
  out[14] = -CLOSE_UP_M;
  out[15] = 1;
}

/** How long the gear takes to come down or go up, the flaps to run all the way and the spoilers to stand up, seconds. */
const GEAR_S = 8;
const FLAPS_S = 6;
const SPOILERS_S = 1;
/** How hard the engines of an aircraft heard in flight are taken to run, and on the ground: what their fans are drawn turning at. */
const SPOOL_FLYING = 0.85;
const SPOOL_GROUND = 0.25;
/** The control surfaces one that has lost some is drawn without: one of these, its own. */
const SURFACES = ["aileron.left", "aileron.right", "elevator.left", "elevator.right", "rudder"] as const;
/** What the renderer is told is gone, for each mix of the wings and the tail (look's bits 0 to 2): made once, never anew. */
const GONE: ReadonlyArray<Readonly<Partial<Record<AircraftPiece, null>>> | undefined> = Array.from({ length: 8 }, (_, bits) => {
  if (!bits) return undefined;
  const gone: Partial<Record<AircraftPiece, null>> = {};
  if (bits & 1) gone.leftWing = null;
  if (bits & 2) gone.rightWing = null;
  if (bits & 4) gone.tail = null;
  return Object.freeze(gone);
});
const SURFACE_GONE: ReadonlyArray<Readonly<Record<string, null>>> = SURFACES.map((part) => Object.freeze({ [part]: null }));

/** Of the wings and the tail, those gone from a look: bit 0 the left wing, 1 the right, 2 the tail. */
export function lostBits(look: OtherAircraft["look"]): number {
  return (look.lost.leftWing ? 1 : 0) | (look.lost.rightWing ? 2 : 0) | (look.lost.tail ? 4 : 0);
}

const step = (from: number, to: number, most: number) => from + Math.min(Math.max(to - from, -most), most);

/**
 * What an aircraft heard shows of itself, as the cockpit's own renderer
 * draws its own (`AircraftView`): its gear, flaps and spoilers moving to
 * where its state and look say at their own pace, what is gone, what burns
 * and its blast; in the hull's frame, through the close-up's camera.
 */
export class CloseUpLook {
  readonly view: AircraftView & { modelView: Float32Array; light: Vec3; fans: { angle: number; sweep: number }; gear: number; flaps: number; spoilers: number };
  readonly effects: AircraftEffects;
  private readonly fires: AircraftEffects["fires"];
  /** Of `fires`, those burning for each mix of `FIRE_PLACES` a look can say: made once, so that none is made on a frame. */
  private readonly burningFires: Array<AircraftEffects["fires"]>;
  private readonly blast: AircraftEffects["blasts"][number] = { at: [0, 0, 1], size: 0, born: 0 };
  private readonly blasts: Array<AircraftEffects["blasts"]> = [[], [this.blast]];
  private fresh = true;
  private fireBorn: number | null = null;
  private blastBorn: number | null = null;
  private readonly turn = new Float64Array(9);

  constructor(calm = false) {
    this.view = {
      modelView: new Float32Array(16), fov: CLOSE_UP_FOV, light: [0, 0, -1], inside: false, veil: 0, flash: 0,
      sunlight: 1, daylight: 1, lightning: 0, fog: 0, gear: 1, flaps: 0, spoilers: 0, fans: { angle: 0, sweep: 0 },
    };
    this.fires = FIRE_PLACES.map((place) => ({ at: [place.at[0], place.at[1], place.at[2]] as Vec3, size: place.size, strength: 0, born: 0 }));
    this.burningFires = Array.from({ length: 1 << FIRE_PLACES.length }, (_, bits) => this.fires.filter((_fire, i) => bits & (1 << i)));
    this.effects = { time: 0, fires: this.burningFires[0], blasts: this.blasts[0], air: [0, 0, 0], up: [0, 0, -1], calm };
  }

  /** Another aircraft, or the same one picked again: everything as it is, at once. */
  reset(): void {
    this.fresh = true;
    this.fireBorn = null;
    this.blastBorn = null;
  }

  /**
   * `aircraft` as `camera` sees it, `dt` seconds after the last time, `now`
   * seconds on the page's clock; lit as `sky` says. The same view each time.
   */
  update(aircraft: OtherAircraft, camera: ChaseView, sky: { sunlight: number; daylight: number }, now: number, dt: number): CloseUpLook["view"] {
    const { shown, look } = aircraft;
    const view = this.view;
    const onGround = (shown.flags & ON_GROUND) !== 0;
    const gear = shown.flags & GEAR_DOWN ? 1 : 0;
    if (this.fresh) {
      view.gear = gear;
      view.flaps = look.flaps;
      view.spoilers = look.spoilers;
      this.fresh = false;
    } else {
      view.gear = step(view.gear, gear, dt / GEAR_S);
      view.flaps = step(view.flaps, look.flaps, dt / FLAPS_S);
      view.spoilers = step(view.spoilers, look.spoilers, dt / SPOILERS_S);
    }
    view.modelView.set(camera.modelView);
    view.light[0] = camera.light[0];
    view.light[1] = camera.light[1];
    view.light[2] = camera.light[2];
    view.sunlight = sky.sunlight;
    view.daylight = sky.daylight;
    // Its fans turning as an airliner's do in flight, or taxiing; still in a wreck.
    const fan = look.crash === "none" ? fanSpeed(onGround ? SPOOL_GROUND : SPOOL_FLYING) : 0;
    view.fans.angle = (view.fans.angle + Math.min(fan, FAN_SHOWN_DEG_S) * dt) % 360;
    view.fans.sweep = fan * FAN_EXPOSURE_S;
    view.pieces = GONE[lostBits(look)];
    view.lost = look.lost.surfaces ? SURFACE_GONE[aircraft.id % SURFACES.length] : undefined;
    view.effects = this.burn(aircraft, now) ? this.effects : undefined;
    return view;
  }

  /** What burns on it and its blast, into `effects`, in its own frame; whether there is any. */
  private burn(aircraft: OtherAircraft, now: number): boolean {
    const { shown, look } = aircraft;
    const effects = this.effects;
    effects.time = now;
    if (look.burning) this.fireBorn ??= now;
    else this.fireBorn = null;
    effects.fires = this.burningFires[look.burning & (this.burningFires.length - 1)];
    for (const fire of effects.fires) {
      fire.strength = look.strength;
      fire.born = this.fireBorn!;
    }
    effects.blasts = this.blasts[look.blast ? 1 : 0];
    if (look.blast) {
      const born = now - look.blast.ago;
      // Heard again, the same blast: kept where it began; one more than a second and a half apart is a new one.
      if (this.blastBorn === null || Math.abs(this.blastBorn - born) > 1.5) this.blastBorn = born;
      const jitter = (look.blast.seed / 255 - 0.5) * 2;
      this.blast.at[0] = jitter;
      this.blast.at[1] = -jitter;
      this.blast.at[2] = 1;
      this.blast.size = look.blast.size;
      this.blast.born = this.blastBorn;
    } else {
      this.blastBorn = null;
    }
    if (!effects.fires.length && !effects.blasts.length) return false;
    // The air going past it, and which way is up, in its own frame: what carries its smoke off and what its fire rises by.
    const a = rotationInto(shown.heading, shown.pitch, shown.roll, this.turn);
    for (let i = 0; i < 3; i++) {
      effects.air[i] = -(a[i] * shown.north + a[3 + i] * shown.east - a[6 + i] * shown.up);
      effects.up[i] = -a[6 + i];
    }
    return true;
  }
}

/** Which of the two models a close-up is drawn with. */
export type CloseUpModel = "full" | "light";

/**
 * From this share of its full sharpness up the close-up is the cockpit's
 * own model, and below it the light one other aircraft are drawn as: on a
 * desk, and in a hand. And it is let go of this much under that, and
 * taken again only once the flight has been at that for so long.
 */
export const FULL_FROM = { desk: 0.85, hand: 0.95 };
const LET_GO = 0.1;
export const FULL_AGAIN_S = 30;

/**
 * Which model the close-up is drawn with: the full one where the flight
 * has the room (`Sharpness.quality`, which falls where frames are short),
 * the light one where it has not. It goes down to the light one before the
 * flight's own picture has to give much up, and back only after a while,
 * so that the two do not take turns.
 */
export class ModelChoice {
  private model: CloseUpModel | null = null;
  private since = -Infinity;

  reset(): void {
    this.model = null;
  }

  /** The model for a flight drawn at `quality` (0.1 to 1), in a hand or not, at `now` seconds. */
  pick(quality: number, handheld: boolean, now: number): CloseUpModel {
    const from = handheld ? FULL_FROM.hand : FULL_FROM.desk;
    if (this.model === null) {
      this.model = quality >= from ? "full" : "light";
      this.since = now;
    } else if (this.model === "full" && quality < from - LET_GO) {
      this.model = "light";
      this.since = now;
    } else if (this.model === "light" && quality < from) {
      this.since = now;
    } else if (this.model === "light" && now - this.since >= FULL_AGAIN_S) {
      this.model = "full";
    }
    return this.model;
  }
}
