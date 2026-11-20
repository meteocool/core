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
 * doors, the wings' flaps, slats and spoilers, and the ailerons, the
 * elevators and the rudder. Each part turns about a hinge of its own as
 * what drives it moves (`partPose`). A file without parts is an aircraft on
 * which nothing does.
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

export type PartDrive = TravelDrive | ControlDrive;

const CONTROLS: ReadonlySet<PartDrive> = new Set<PartDrive>(["ailerons", "elevator", "rudder"]);

/**
 * Where each of those is. What travels, 0 to 1: the gear up to down, the
 * flaps in to all the way out, the spoilers flat to all the way up. What is
 * deflected, -1 to 1, with the signs of the flight's own controls:
 * `ailerons` right wing down, `elevator` nose up, `rudder` nose right; in
 * the middle where not said.
 */
export type PartPositions = Record<TravelDrive, number> & Partial<Record<ControlDrive, number>>;

/**
 * A part that turns as what drives it moves: about `axis` (a unit vector,
 * the right-handed way) through `pivot`, by an angle in degrees that
 * follows that position through `keys` (position, angle). What travels is
 * eased between each two keys, as a leg swings; what is deflected follows
 * them straight, as a surface follows the stick. Driven by the gear where
 * the file does not say.
 */
export interface ModelPart {
  pivot: Vec3;
  axis: Vec3;
  keys: Array<[number, number]>;
  drive?: PartDrive;
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

/** A part's angle, degrees, with what drives it at `position`: held at its first key before it, and at its last past it. */
export function partAngle(part: ModelPart, position: number): number {
  const { keys } = part;
  if (!keys.length) return 0;
  if (!(position > keys[0][0])) return keys[0][1];
  const straight = CONTROLS.has(part.drive ?? "gear");
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
  if (Math.abs(angle) < 1e-4) return null;
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
  for (const [name, part] of Object.entries(parts)) {
    const pose = partPose(part, positions[part.drive ?? "gear"] ?? 0);
    if (!pose) continue;
    const { turn } = pose;
    posed.set(name, {
      modelView: new Float32Array(multiply4(modelView, pose.matrix)),
      light: [0, 1, 2].map((i) => turn[0][i] * light[0] + turn[1][i] * light[1] + turn[2][i] * light[2]) as Vec3,
    });
  }
  return posed;
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
