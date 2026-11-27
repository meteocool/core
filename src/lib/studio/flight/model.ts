/**
 * The aircraft's model as the flight loads it: one file of meshes, written
 * by scripts/models/convert-aircraft.py from the model as its author
 * published it.
 *
 * The file: `MCM1`, the length of a JSON header, the header, then for each
 * chunk its vertices and its indices. A vertex is sixteen bytes: its place
 * as three 16-bit steps across the chunk's own box (and two spare bytes),
 * its normal as three signed bytes (and one spare), its place on the texture
 * as two 16-bit steps across the chunk's own stretch of it. Indices are 16
 * bits. Positions are metres in the aircraft's frame: forward, right, down.
 *
 * Some chunks belong to a part that moves: the landing gear's legs and
 * doors, the wings' flaps, slats and spoilers, the ailerons, the elevators
 * and the rudder, the engines' fans, and the flight deck's stick, levers
 * and pedals. Each part
 * turns about a hinge of its own as what drives it moves (`partPose`), or
 * slides along it; a part may ride on another, which moves it too. A file
 * without parts is an aircraft on which nothing does.
 *
 * An aircraft that has broken up is drawn in pieces, each a part of the
 * same meshes: which piece a point of the model is of is said here too
 * (`pieceOf`), by where the point is.
 */

export const VERTEX_BYTES = 16;

type Vec3 = [number, number, number];

export interface ModelMaterial {
  /** The texture's file, beside the model; null for a plain colour. */
  texture: string | null;
  colour: [number, number, number];
  opacity: number;
}

export interface ModelChunk {
  material: number;
  /** `VERTEX_BYTES` each. */
  vertices: Uint8Array;
  indices: Uint16Array;
  /** The box the positions are steps across, and the stretch of texture the texture coordinates are. */
  min: [number, number, number];
  size: [number, number, number];
  uvMin: [number, number];
  uvSize: [number, number];
  /** The moving part it belongs to, by name in `AircraftModel.parts`; absent for the fixed rest. */
  part?: string;
}

/** What a part is moved by and travels with, one way: the landing gear, the flaps' lever (slats and flaps both), or the spoilers. */
export type TravelDrive = "gear" | "flaps" | "spoilers";

/** What a part is deflected by, either way from its middle: the stick's two axes and the pedals. */
export type ControlDrive = "ailerons" | "elevator" | "rudder";

/**
 * What a control of the flight deck is moved by, as `CockpitPose` has it
 * (`cockpitDrives`): the stick's two axes, the thrust levers, the flap
 * lever, the speed brake's lever and its arming, the gear's lever, the
 * pedals, the parking brake's handle and the rudder trim's knob.
 */
export type CockpitDrive =
  | "stickPitch" | "stickRoll" | "thrustLevers" | "flapLever" | "speedBrakeLever" | "spoilersArmed"
  | "gearLever" | "pedals" | "parkingBrake" | "rudderTrim";

/** What turns a part round and round: the engines' fans, by how far they have turned, degrees. */
export type SpinDrive = "fans";

export type PartDrive = TravelDrive | ControlDrive | CockpitDrive | SpinDrive;

/** What a part follows straight from key to key: a hand's controls, and the surfaces they move. Smoothing them is the hand's (or the pilot's). */
const STRAIGHT: ReadonlySet<PartDrive> = new Set<PartDrive>([
  "ailerons", "elevator", "rudder",
  "stickPitch", "stickRoll", "thrustLevers", "flapLever", "speedBrakeLever", "spoilersArmed", "gearLever", "pedals", "parkingBrake", "rudderTrim",
  "fans",
]);

/**
 * Where each of those is. What travels, 0 to 1: the gear up to down, the
 * flaps in to all the way out, the spoilers flat to all the way up. What is
 * deflected, -1 to 1, with the signs of the flight's own controls:
 * `ailerons` right wing down, `elevator` nose up, `rudder` nose right; in
 * the middle where not said. What spins, degrees, round and round: as the
 * model has it at every whole turn, and where not said.
 */
export type PartPositions = Record<TravelDrive, number> & Partial<Record<ControlDrive | CockpitDrive | SpinDrive, number>>;

/**
 * A part that turns as what drives it moves: about `axis` (a unit vector,
 * the right-handed way) through `pivot`, by an angle in degrees that
 * follows that position through `keys` (position, angle). What travels is
 * eased between each two keys, as a leg swings; what is deflected follows
 * them straight, as a surface follows the stick. Driven by the gear where
 * the file does not say.
 *
 * A part that `slide`s goes along `axis` instead, by metres that follow the
 * keys. A part with a `parent` is carried by that part: it moves as its
 * parent does, and turns or slides on it as well, as a stick that rolls is
 * carried by its gimbal that pitches. A parent may have nothing drawn.
 *
 * A part that spins (driven by `fans`) takes its drive a turn at a time:
 * its keys go once round, and the drive's every whole turn is their start
 * again. One with `blades` is a fan of that many like blades, seen as it
 * was when turned by one blade's share of the round; one without is round,
 * as a spinner is, and only its markings show it turning (`smearedParts`).
 */
export interface ModelPart {
  pivot: Vec3;
  axis: Vec3;
  keys: Array<[number, number]>;
  drive?: PartDrive;
  slide?: boolean;
  parent?: string;
  blades?: number;
}

export interface AircraftModel {
  title: string;
  author: string;
  licence: string;
  source: string;
  materials: ModelMaterial[];
  chunks: ModelChunk[];
  parts: Record<string, ModelPart>;
}

interface ChunkHeader {
  material: number;
  vertices: number;
  indices: number;
  offset: number;
  min: [number, number, number];
  size: [number, number, number];
  uvMin: [number, number];
  uvSize: [number, number];
  part?: string;
}

/** Read a model's file. Throws on anything that is not one. */
export function parseModel(buffer: ArrayBuffer): AircraftModel {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "MCM1") throw new Error(`not an aircraft model: ${magic}`);
  const headerBytes = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerBytes))) as {
    title: string; author: string; licence: string; source: string; materials: ModelMaterial[]; chunks: ChunkHeader[];
    parts?: Record<string, ModelPart>;
  };
  const parts = header.parts ?? {};
  const body = 8 + headerBytes;
  const chunks = header.chunks.map((chunk): ModelChunk => {
    const at = body + chunk.offset;
    const vertexBytes = chunk.vertices * VERTEX_BYTES;
    if (at + vertexBytes + chunk.indices * 2 > buffer.byteLength) throw new Error("aircraft model cut short");
    return {
      material: chunk.material,
      vertices: new Uint8Array(buffer, at, vertexBytes),
      indices: new Uint16Array(buffer, at + vertexBytes, chunk.indices),
      min: chunk.min,
      size: chunk.size,
      uvMin: chunk.uvMin,
      uvSize: chunk.uvSize,
      // A part the header does not describe would never move: drawn as the rest is.
      ...(chunk.part && parts[chunk.part] ? { part: chunk.part } : {}),
    };
  });
  return {
    title: header.title, author: header.author, licence: header.licence, source: header.source,
    materials: header.materials, chunks, parts,
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** A part's angle, degrees (metres for one that slides), with what drives it at `position`: held at its first key before it, and at its last past it. */
export function partAngle(part: ModelPart, position: number): number {
  const { keys } = part;
  if (!keys.length) return 0;
  if (part.drive === "fans") position = ((position % 360) + 360) % 360;
  if (!(position > keys[0][0])) return keys[0][1];
  const straight = STRAIGHT.has(part.drive ?? "gear");
  for (let i = 1; i < keys.length; i++) {
    const [to, angle] = keys[i];
    if (position <= to) {
      const [from, before] = keys[i - 1];
      const along = to > from ? (position - from) / (to - from) : 1;
      return before + (angle - before) * (straight ? along : smooth(along));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Where a part is with what drives it at `position`: its turn about its
 * hinge as a 4x4 from the part's place in the model to where it is now,
 * columns first, and the 3x3 of the turn alone (rows), for its normals.
 * Null where it is where the model has it.
 */
export function partPose(part: ModelPart, position: number): { matrix: number[]; turn: [Vec3, Vec3, Vec3] } | null {
  const angle = partAngle(part, position);
  if (Math.abs(angle) < (part.slide ? 1e-6 : 1e-4)) return null;
  if (part.slide) {
    const [x, y, z] = part.axis;
    return { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x * angle, y * angle, z * angle, 1], turn: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
  }
  const radians = (angle * Math.PI) / 180;
  const [x, y, z] = part.axis;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  // Rodrigues' rotation, rows.
  const turn: [Vec3, Vec3, Vec3] = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  // About the pivot: p' = R (p - pivot) + pivot.
  const [px, py, pz] = part.pivot;
  const shift = turn.map((row, i) => part.pivot[i] - (row[0] * px + row[1] * py + row[2] * pz));
  const matrix = [
    turn[0][0], turn[1][0], turn[2][0], 0,
    turn[0][1], turn[1][1], turn[2][1], 0,
    turn[0][2], turn[1][2], turn[2][2], 0,
    shift[0], shift[1], shift[2], 1,
  ];
  return { matrix, turn };
}

/** A part's place with `positions`, its parents' moves and its own (as `partPose` has it); null where that is where the model has it. */
function carried(
  parts: Record<string, ModelPart>, name: string, positions: PartPositions, depth = 0,
): { matrix: number[]; turn: [Vec3, Vec3, Vec3] } | null {
  const part = parts[name];
  const own = partPose(part, positions[part.drive ?? "gear"] ?? 0);
  // A parent the file does not have, or a loop of them, carries nothing.
  const parent = part.parent && parts[part.parent] && depth < 8 ? carried(parts, part.parent, positions, depth + 1) : null;
  if (!parent || !own) return parent ?? own;
  const turn = [0, 1, 2].map((row) => [0, 1, 2].map((column) => (
    parent.turn[row][0] * own.turn[0][column] + parent.turn[row][1] * own.turn[1][column] + parent.turn[row][2] * own.turn[2][column]
  ))) as [Vec3, Vec3, Vec3];
  return { matrix: multiply4(parent.matrix, own.matrix), turn };
}

/**
 * Every part's place with the gear, the flaps, the spoilers and the
 * controls where `positions` has them, for a frame seen through `modelView`: the
 * model-view it is drawn with, and the light (`light`, in the aircraft's
 * frame) as its own turned normals meet it. Parts where the model has them
 * are left out: they are drawn as the rest is.
 */
export function posedParts(
  parts: Record<string, ModelPart>, positions: PartPositions, modelView: ArrayLike<number>, light: Vec3,
): Map<string, { modelView: Float32Array; light: Vec3 }> {
  const posed = new Map<string, { modelView: Float32Array; light: Vec3 }>();
  for (const name of Object.keys(parts)) {
    const pose = carried(parts, name, positions);
    if (!pose) continue;
    const { turn } = pose;
    posed.set(name, {
      modelView: new Float32Array(multiply4(modelView, pose.matrix)),
      light: [0, 1, 2].map((i) => turn[0][i] * light[0] + turn[1][i] * light[1] + turn[2][i] * light[2]) as Vec3,
    });
  }
  return posed;
}

/** A part that spins, and so is smeared over what it turns through while a frame is seen. */
export function spins(part: ModelPart): boolean {
  return part.drive === "fans";
}

/** How finely a smear is drawn: a copy of the part for each this many degrees of it. */
const SMEAR_STEP_DEG = 2;
/** And at most this many copies, however far it turns. */
const SMEAR_MOST = 16;

/**
 * The parts that spin, as the eye sees them while a frame is shown: each
 * drawn several times over, through each of the places it passes through
 * as it turns `sweep` degrees back from where `positions` has it, each copy
 * as opaque as `opacity` says, so that together they are the part's smear.
 * A fan's no further round than one blade's share, which shows all there is
 * of it (and so never one that seems to stand or turn back); a round part's
 * no further than a whole turn. Over a sweep of under a degree, none; nor
 * of a part the eye is behind, which is seen, if at all, from behind its
 * blades (a fan from inside its engine): it is drawn as it is.
 */
export function smearedParts(
  parts: Record<string, ModelPart>, positions: PartPositions, sweep: number, modelView: ArrayLike<number>, light: Vec3,
): Map<string, { opacity: number; copies: Array<{ modelView: Float32Array; light: Vec3 }> }> {
  const smeared = new Map<string, { opacity: number; copies: Array<{ modelView: Float32Array; light: Vec3 }> }>();
  if (!(sweep >= 1)) return smeared;
  const eye = eyeOf(modelView);
  for (const [name, part] of Object.entries(parts)) {
    if (!spins(part)) continue;
    if ([0, 1, 2].reduce((sum, i) => sum + (eye[i] - part.pivot[i]) * part.axis[i], 0) < 0) continue;
    const drive = part.drive ?? "gear";
    const span = Math.min(sweep, 360 / Math.max(part.blades ?? 1, 1));
    const count = Math.min(SMEAR_MOST, Math.max(2, Math.ceil(span / SMEAR_STEP_DEG)));
    const copies: Array<{ modelView: Float32Array; light: Vec3 }> = [];
    for (let i = 0; i < count; i++) {
      const at = { ...positions, [drive]: (positions[drive] ?? 0) - (span * i) / count };
      const pose = carried(parts, name, at);
      const turn = pose?.turn ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      copies.push({
        modelView: new Float32Array(pose ? multiply4(modelView, pose.matrix) : modelView),
        light: [0, 1, 2].map((k) => turn[0][k] * light[0] + turn[1][k] * light[1] + turn[2][k] * light[2]) as Vec3,
      });
    }
    // Drawn one over another, each lets through what is behind it: as opaque as leaves a tenth of it where all of them are.
    smeared.set(name, { opacity: 1 - 0.1 ** (1 / count), copies });
  }
  return smeared;
}

/** A part where `PartPoser` has it: the model-view it is drawn with, and the light as its own turned normals meet it. */
export interface PosedPart {
  modelView: Float32Array;
  light: Vec3;
}

/** A spinning part's smear, as `PartPoser` has it: its first `count` copies, each as opaque as `opacity`. */
export interface SmearedPart {
  opacity: number;
  count: number;
  copies: PosedPart[];
}

/**
 * `posedParts` and `smearedParts` for an aircraft drawn every frame, with
 * nothing made anew: each part's numbers are kept from frame to frame and
 * written over, so the same numbers come out as those two give, in maps
 * that are the same maps every frame (`posed`, `smeared`). What it answers
 * holds until it is asked again.
 */
export class PartPoser {
  readonly posed = new Map<string, PosedPart>();
  readonly smeared = new Map<string, SmearedPart>();
  private readonly names: string[];
  private readonly kept = new Map<string, PosedPart>();
  private readonly smears = new Map<string, SmearedPart>();
  /** A matrix and a turn for each depth of parents, and one more of each to multiply into. */
  private readonly matrices = Array.from({ length: 11 }, () => new Float64Array(16));
  private readonly turns = Array.from({ length: 11 }, () => new Float64Array(9));
  private readonly eye: Vec3 = [0, 0, 0];
  private readonly parts: Record<string, ModelPart>;

  constructor(parts: Record<string, ModelPart>) {
    this.parts = parts;
    this.names = Object.keys(parts);
    const blank = (): PosedPart => ({ modelView: new Float32Array(16), light: [0, 0, 0] });
    for (const name of this.names) {
      this.kept.set(name, blank());
      if (spins(parts[name])) this.smears.set(name, { opacity: 0, count: 0, copies: Array.from({ length: SMEAR_MOST }, blank) });
    }
  }

  /**
   * Every part where `positions` has it, seen through `modelView` and lit
   * from `light` (`posedParts`), and with `sweep` the spinning ones' smears
   * (`smearedParts`). `positions` is borrowed while it works, and left as it
   * was.
   */
  pose(positions: PartPositions, sweep: number, modelView: ArrayLike<number>, light: Readonly<Vec3>): this {
    this.posed.clear();
    this.smeared.clear();
    const matrix = this.matrices[0];
    const turn = this.turns[0];
    for (const name of this.names) {
      if (!this.carried(name, positions, 0)) continue;
      const entry = this.kept.get(name)!;
      placeInto(entry, modelView, matrix, turn, light);
      this.posed.set(name, entry);
    }
    if (!(sweep >= 1)) return this;
    const eye = eyeInto(modelView, this.eye);
    for (const name of this.names) {
      const part = this.parts[name];
      if (!spins(part)) continue;
      if ((eye[0] - part.pivot[0]) * part.axis[0] + (eye[1] - part.pivot[1]) * part.axis[1] + (eye[2] - part.pivot[2]) * part.axis[2] < 0) continue;
      const drive = part.drive ?? "gear";
      const span = Math.min(sweep, 360 / Math.max(part.blades ?? 1, 1));
      const count = Math.min(SMEAR_MOST, Math.max(2, Math.ceil(span / SMEAR_STEP_DEG)));
      const smear = this.smears.get(name)!;
      // Every key of the positions may be written: put back as it was after.
      const moving = positions as Partial<Record<PartDrive, number>>;
      const was = moving[drive];
      for (let i = 0; i < count; i++) {
        moving[drive] = (was ?? 0) - (span * i) / count;
        const copy = smear.copies[i];
        if (this.carried(name, positions, 0)) {
          placeInto(copy, modelView, matrix, turn, light);
        } else {
          copy.modelView.set(modelView);
          copy.light[0] = light[0];
          copy.light[1] = light[1];
          copy.light[2] = light[2];
        }
      }
      moving[drive] = was;
      smear.opacity = 1 - 0.1 ** (1 / count);
      smear.count = count;
      this.smeared.set(name, smear);
    }
    return this;
  }

  /** `carried`, into this depth's matrix and turn; false where the part is where the model has it. */
  private carried(name: string, positions: PartPositions, depth: number): boolean {
    const part = this.parts[name];
    const matrix = this.matrices[depth];
    const turn = this.turns[depth];
    const own = partPoseInto(part, positions[part.drive ?? "gear"] ?? 0, matrix, turn);
    const parent = part.parent && this.parts[part.parent] && depth < 8 ? this.carried(part.parent, positions, depth + 1) : false;
    if (!parent) return own;
    const pm = this.matrices[depth + 1];
    const pt = this.turns[depth + 1];
    if (!own) {
      matrix.set(pm);
      turn.set(pt);
      return true;
    }
    // The parent's move after the part's own, into the spare pair, then back here.
    const m = this.matrices[10];
    const t = this.turns[10];
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        t[row * 3 + column] = pt[row * 3] * turn[column] + pt[row * 3 + 1] * turn[3 + column] + pt[row * 3 + 2] * turn[6 + column];
      }
    }
    multiplyInto(m, pm, matrix);
    matrix.set(m);
    turn.set(t);
    return true;
  }
}

/** `partPose` into `matrix` (columns first) and `turn` (rows); false, and neither written, where the part is where the model has it. */
function partPoseInto(part: ModelPart, position: number, matrix: Float64Array, turn: Float64Array): boolean {
  const angle = partAngle(part, position);
  if (Math.abs(angle) < (part.slide ? 1e-6 : 1e-4)) return false;
  const x = part.axis[0], y = part.axis[1], z = part.axis[2];
  if (part.slide) {
    matrix.fill(0);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    matrix[12] = x * angle;
    matrix[13] = y * angle;
    matrix[14] = z * angle;
    turn.fill(0);
    turn[0] = turn[4] = turn[8] = 1;
    return true;
  }
  const radians = (angle * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  turn[0] = t * x * x + c; turn[1] = t * x * y - s * z; turn[2] = t * x * z + s * y;
  turn[3] = t * x * y + s * z; turn[4] = t * y * y + c; turn[5] = t * y * z - s * x;
  turn[6] = t * x * z - s * y; turn[7] = t * y * z + s * x; turn[8] = t * z * z + c;
  const px = part.pivot[0], py = part.pivot[1], pz = part.pivot[2];
  for (let i = 0; i < 3; i++) {
    matrix[i * 4] = turn[i];
    matrix[i * 4 + 1] = turn[3 + i];
    matrix[i * 4 + 2] = turn[6 + i];
    matrix[i * 4 + 3] = 0;
    matrix[12 + i] = part.pivot[i] - (turn[i * 3] * px + turn[i * 3 + 1] * py + turn[i * 3 + 2] * pz);
  }
  matrix[15] = 1;
  return true;
}

/** A part seen through `modelView`, moved by `matrix` and turned by `turn`, lit from `light`: into `out`. */
function placeInto(out: PosedPart, modelView: ArrayLike<number>, matrix: Float64Array, turn: Float64Array, light: Readonly<Vec3>): void {
  multiplyInto(out.modelView, modelView, matrix);
  for (let i = 0; i < 3; i++) out.light[i] = turn[i] * light[0] + turn[3 + i] * light[1] + turn[6 + i] * light[2];
}

/** `multiply4`, into `out`. */
export function multiplyInto(out: Float32Array | Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): Float32Array | Float64Array {
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** `eyeOf`, into `out`. */
function eyeInto(m: ArrayLike<number>, out: Vec3): Vec3 {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], k = m[10];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (!det) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const x = m[12], y = m[13], z = m[14];
  out[0] = -((e * k - f * h) * x + (c * h - b * k) * y + (b * f - c * e) * z) / det;
  out[1] = -((f * g - d * k) * x + (a * k - c * g) * y + (c * d - a * f) * z) / det;
  out[2] = -((d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d) * z) / det;
  return out;
}

/** Where the eye is in the frame a model-view draws, columns first: what it puts at the camera. */
function eyeOf(m: ArrayLike<number>): Vec3 {
  // The inverse of its turn (a stretch too, if it has one) on its shift, the other way.
  const [a, b, c, d, e, f, g, h, k] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (!det) return [0, 0, 0];
  const inverse = [
    [e * k - f * h, c * h - b * k, b * f - c * e],
    [f * g - d * k, a * k - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d],
  ];
  const shift = [m[12], m[13], m[14]];
  return inverse.map((row) => -(row[0] * shift[0] + row[1] * shift[1] + row[2] * shift[2]) / det) as Vec3;
}

/** The fans' speed at idle and at full power, degrees a second: a CFM56's N1 at 100 per cent is 5,000 a minute. */
const FAN_IDLE_DEG_S = 300;
const FAN_FULL_DEG_S = 30_000;
/**
 * And how fast they are shown turning, at most, degrees a second: about as
 * fast as an eye can follow from frame to frame, a blade's share in a few
 * of them. Faster, they are seen smeared instead.
 */
export const FAN_SHOWN_DEG_S = 360;
/** How long a frame is seen for, seconds: what the fans are smeared over the turning of. */
export const FAN_EXPOSURE_S = 1 / 60;

/**
 * How fast the fans turn, degrees a second, with the engines' spool where
 * it is (0 idle to 1 full power, as N1 goes) and the engines running as far
 * as `running` says (0 stopped, 1 running). Slowly enough at idle to see
 * the blades go round, and faster each step of power by as much again, to
 * a blur.
 */
export function fanSpeed(spool: number, running = 1): number {
  const power = Math.min(Math.max(spool, 0), 1);
  return FAN_IDLE_DEG_S * (FAN_FULL_DEG_S / FAN_IDLE_DEG_S) ** power * Math.min(Math.max(running, 0), 1);
}

/**
 * Where the flight deck's controls are this frame. Each is where the model
 * has it where not said: the stick upright, the levers at idle, retracted,
 * flaps 0 and gear up, the pedals level, the brake off.
 */
export interface CockpitPose {
  /** The captain's sidestick, -1 to 1 each: `pitch` pulled back (nose up) positive, `roll` to the right positive. */
  stickPitch?: number;
  stickRoll?: number;
  /**
   * The thrust levers, both together: 0 at idle to 1 at TOGA, through the
   * climb detent (`THRUST_DETENTS.climb`) and the maximum continuous one;
   * below 0, to -1, pulled back into full reverse.
   */
  thrust?: number;
  /** The flap lever, 0 (up) to 4 (FULL) in its detents; between them on its way. It moves at once, the flaps follow it later. */
  flapLever?: number;
  /** The speed brake's lever, 0 retracted to 1 full; and how far it is pulled up out of its notch, 0 to 1: the ground spoilers armed. */
  speedBrake?: number;
  groundSpoilersArmed?: number;
  /** The landing gear's lever, 0 up to 1 down. */
  gearLever?: number;
  /** The rudder pedals, -1 to 1: the right one pushed forward (nose right) positive, the left one back as far. Both pilots' move together. */
  pedals?: number;
  /** The parking brake's handle, 0 off to 1 turned on. */
  parkingBrake?: number;
  /** The rudder trim's knob, -1 to 1, turned right positive. */
  rudderTrim?: number;
}

/** The thrust levers' detents on the quadrant, as `CockpitPose.thrust` has them: idle, climb, maximum continuous (flex), take-off/go-around, and full reverse. */
export const THRUST_DETENTS = { reverse: -1, idle: 0, climb: 25 / 45, maxContinuous: 35 / 45, toga: 1 } as const;

/** What a pose of the flight deck drives, by drive: what `posedParts` takes for its controls. */
export function cockpitDrives(pose: CockpitPose | undefined): Partial<Record<CockpitDrive, number>> {
  if (!pose) return {};
  return {
    stickPitch: pose.stickPitch ?? 0, stickRoll: pose.stickRoll ?? 0, thrustLevers: pose.thrust ?? 0, flapLever: pose.flapLever ?? 0,
    speedBrakeLever: pose.speedBrake ?? 0, spoilersArmed: pose.groundSpoilersArmed ?? 0, gearLever: pose.gearLever ?? 0,
    pedals: pose.pedals ?? 0, parkingBrake: pose.parkingBrake ?? 0, rudderTrim: pose.rudderTrim ?? 0,
  };
}

/** Two 4x4s, columns first: `a` after `b`. */
export function multiply4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** What an aircraft breaks into: its hull, each wing with its engine and its leg, and the tail with its fin and tailplane. */
export type ModelPiece = "hull" | "leftWing" | "rightWing" | "tail";

/** The pieces in the order the renderer counts them: a piece's place here is its number in the shader. */
export const PIECES: readonly ModelPiece[] = ["hull", "leftWing", "rightWing", "tail"];

/**
 * Where the aircraft comes apart, metres in its own frame: a wing at the
 * fuselage's side, outside the fairing under the belly and inside the flaps'
 * inner ends, so the engine, the main leg and every surface of the wing go
 * with it; the tail behind the rear doors, ahead of where the fin and the
 * tailplane leave the fuselage. A break is not a clean cut: it wanders
 * `ragged` metres either side of its line (the renderer's shader says how).
 */
export const BREAKS = { wingRoot: 2.15, tail: -13.8, ragged: 0.15 };

/** Which piece a point of the model is of, as the model has it (before any part has moved). */
export function pieceOf([forward, right]: Vec3 | readonly number[]): ModelPiece {
  if (forward < BREAKS.tail) return "tail";
  if (right < -BREAKS.wingRoot) return "leftWing";
  if (right > BREAKS.wingRoot) return "rightWing";
  return "hull";
}

/**
 * Which pieces a box of the model (its least corner, its size) may have
 * points of, the breaks being ragged: what a mesh has to be drawn as part of.
 */
export function piecesOf(min: readonly number[], size: readonly number[]): ModelPiece[] {
  const { wingRoot, tail, ragged } = BREAKS;
  const found: ModelPiece[] = [];
  const ahead = min[0] + size[0] >= tail - ragged;
  if (ahead && min[1] <= wingRoot + ragged && min[1] + size[1] >= -wingRoot - ragged) found.push("hull");
  if (ahead && min[1] < -wingRoot + ragged) found.push("leftWing");
  if (ahead && min[1] + size[1] > wingRoot - ragged) found.push("rightWing");
  if (min[0] < tail + ragged) found.push("tail");
  return found;
}
