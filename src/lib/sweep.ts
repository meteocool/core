/**
 * Unpacking one radar's sweep: one tilt, one quantity, in the radar's own polar bins.
 *
 * The composites answer where it is raining. Site mode answers what one radar
 * saw at one tilt, which is how storm chasers read radar: its radial velocity
 * for rotation, its reflectivity for the hook. ng publishes every sweep up to
 * six degrees as one object (worker-analysis `sweeps.py`, ng
 * `doc/site-sweeps.md`), and the map draws it in its own bins
 * (`layers/siteSweep.ts`) rather than as tiles.
 *
 * ## The Wire Format
 *
 * `MCSW`, a version, a JSON header and then `nrays x nbins` bytes, rays
 * outermost, gzipped whole and served with `Content-Encoding: gzip`, so the
 * browser has unwrapped it by the time this sees it, as `cellCutaway.ts`'s
 * volumes are. The rays lie on a regular grid from `azimuth0_deg` in steps of
 * `azimuth_step_deg`, clockwise from north, which the server laid them on.
 *
 * Reflectivity is `rvp6-u8`, as every radar tile: byte / 2 - 32.5 dBZ, 0 no
 * echo, 255 not measured, so `rvp6Table` colours it unchanged. Velocity is
 * `vrad-u8`: 0 not measured, 1 no echo, 2 to 254 are (byte - 128) x 0.5 m/s,
 * positive away from the radar, and 255 where the dealiaser gave up.
 *
 * Pure: no fetch and nothing of Vite's, so the unit tests can run it.
 */

const MAGIC = 0x5753434d; // "MCSW", little-endian

export const RVP6 = "rvp6-u8";
export const VRAD = "vrad-u8";

/** `vrad-u8`'s reserved bytes, and the step and zero of the rest. */
export const VRAD_NOT_MEASURED = 0;
export const VRAD_NO_ECHO = 1;
export const VRAD_UNRESOLVED = 255;
export const VRAD_ZERO = 128;
export const VRAD_STEP_M_S = 0.5;

/** What the header says of one sweep. */
export interface SweepHeader {
  site: string;
  network: string;
  lat: number;
  lon: number;
  /** The antenna above sea level. */
  height_m: number;
  elevation_deg: number;
  beamwidth_deg: number;
  /** Where the first bin starts, and how long each is, along the beam. */
  range_start_m: number;
  range_step_m: number;
  nrays: number;
  nbins: number;
  /** The first ray's centre, clockwise from north, and the step between rays. */
  azimuth0_deg: number;
  azimuth_step_deg: number;
  quantity: "DBZH" | "VRADH";
  encoding: typeof RVP6 | typeof VRAD;
  /** The fastest radial wind the radar measures before it folds; null for reflectivity, or unknown. */
  nyquist_m_s: number | null;
  /** Whether the server unfolded it: a fold looks exactly like a couplet. */
  dealiased: boolean;
  /** Which dealiaser and version, when it was. */
  dealiaser: string | null;
  /** The minute in the source file's name; and when the antenna swept this tilt, ISO. */
  scanned_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface Sweep {
  header: SweepHeader;
  /** `nrays x nbins` bytes, rays outermost: an R8 texture `nbins` wide as it is. */
  bins: Uint8Array;
}

/** Unpack one object, already gunzipped by the browser. Throws on anything that is not a sweep. */
export function decodeSweep(buffer: ArrayBuffer): Sweep {
  if (buffer.byteLength < 12) throw new Error("not a sweep");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("not a sweep");
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`unknown sweep version ${version}`);
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength))) as SweepHeader;
  const bins = new Uint8Array(buffer, 12 + headerLength);
  const wanted = header.nrays * header.nbins;
  if (bins.length !== wanted) throw new Error(`sweep is ${bins.length} bytes, header wants ${wanted}`);
  return { header, bins };
}

/**
 * A sweep that is not there any more: past the bucket's day, or never
 * published. The bucket answers 403 for a key it does not have, so both
 * mean this, as for the volumes.
 */
export class SweepGone extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`sweep ${path}: ${status}`);
    this.name = "SweepGone";
    this.status = status;
  }
}

/** What one bin holds. */
export type BinReading =
  | { kind: "unmeasured" }
  | { kind: "no_echo" }
  | { kind: "unresolved" }
  | { kind: "value"; value: number };

/** A bin's byte as what it means, in dBZ or m/s. */
export function readBin(encoding: SweepHeader["encoding"], byte: number): BinReading {
  if (encoding === RVP6) {
    if (byte === 255) return { kind: "unmeasured" };
    if (byte === 0) return { kind: "no_echo" };
    return { kind: "value", value: byte / 2 - 32.5 };
  }
  if (byte === VRAD_NOT_MEASURED) return { kind: "unmeasured" };
  if (byte === VRAD_NO_ECHO) return { kind: "no_echo" };
  if (byte === VRAD_UNRESOLVED) return { kind: "unresolved" };
  return { kind: "value", value: (byte - VRAD_ZERO) * VRAD_STEP_M_S };
}

/** A velocity in m/s as the byte `vrad-u8` gives it, clipped to the bytes that hold one. */
export function velocityByte(metresPerSecond: number): number {
  return Math.min(254, Math.max(2, Math.round(metresPerSecond / VRAD_STEP_M_S) + VRAD_ZERO));
}
