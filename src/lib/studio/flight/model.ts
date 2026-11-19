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
 * doors, and the wings' flaps, slats and spoilers. Each part turns about a
 * hinge of its own as what drives it moves (`partPose`). A file without
 * parts is an aircraft on which nothing does.
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

/** What moves a part: the landing gear, the flaps' lever (slats and flaps both), or the spoilers. */
export type PartDrive = "gear" | "flaps" | "spoilers";

/**
 * How far each of those is along, 0 to 1: the gear up to down, the flaps in
 * to all the way out, the spoilers flat to all the way up.
 */
export type PartPositions = Record<PartDrive, number>;

/**
 * A part that turns as what drives it moves: about `axis` (a unit vector,
 * the right-handed way) through `pivot`, by an angle in degrees that
 * follows that position, 0 to 1, through `keys` (position, angle), eased
 * between each two. Driven by the gear where the file does not say.
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

/** A part's angle, degrees, with what drives it at `position` (0 to 1). */
export function partAngle(part: ModelPart, position: number): number {
  const { keys } = part;
  if (!keys.length) return 0;
  const at = Math.min(Math.max(position, 0), 1);
  if (at <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [to, angle] = keys[i];
    if (at <= to) {
      const [from, before] = keys[i - 1];
      return before + (angle - before) * smooth(to > from ? (at - from) / (to - from) : 1);
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
 * Every part's place with the gear, the flaps and the spoilers where
 * `positions` has them, for a frame seen through `modelView`: the
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
