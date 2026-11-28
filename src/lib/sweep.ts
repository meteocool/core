/**
 * Unpacking one radar's sweep: one tilt, one quantity, in the radar's own polar bins.
 *
 * The composites answer where it is raining. Site mode answers what one radar
 * saw at one tilt, which is how storm chasers read radar: its radial velocity
 * for rotation, its reflectivity for the hook. The backend publishes every sweep up
 * to six degrees as one object, and the map draws it in its own bins
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
 * A dual-polarisation radar's lowest tilt also carries its correlation
 * coefficient, `rhohv-u8` (2 to 254 are 0.2 + (byte - 2) x 0.004), and its
 * differential reflectivity, `zdr-u8` ((byte - 128) / 16 dB); in both 0 is
 * not measured and 1 no echo, or for the coefficient too weak to read. The
 * dealiased velocity's azimuthal shear, `shear-u8`, and its radial
 * divergence, `divshear-u8`, are (byte - 128) x 1e-4 and x 2e-4 per second,
 * positive cyclonic and divergent; 0 is no estimate (not measured, or too
 * few neighbours for the fit) and 1 masked (no echo, too weak, or folded).
 *
 * Pure: no fetch and nothing of Vite's, so the unit tests can run it.
 */

const MAGIC = 0x5753434d; // "MCSW", little-endian

export const RVP6 = "rvp6-u8";
export const VRAD = "vrad-u8";
export const RHOHV = "rhohv-u8";
export const ZDR = "zdr-u8";
export const SHEAR = "shear-u8";
export const DIVSHEAR = "divshear-u8";

export type Encoding = typeof RVP6 | typeof VRAD | typeof RHOHV | typeof ZDR | typeof SHEAR | typeof DIVSHEAR;

/** `vrad-u8`'s reserved bytes, and the step and zero of the rest. */
export const VRAD_NOT_MEASURED = 0;
export const VRAD_NO_ECHO = 1;
export const VRAD_UNRESOLVED = 255;
export const VRAD_ZERO = 128;
export const VRAD_STEP_M_S = 0.5;

/** `rhohv-u8`: byte 2 is this coefficient (and anything under it), each byte above it this much more. */
export const RHOHV_FLOOR = 0.2;
export const RHOHV_STEP = 0.004;
/** `zdr-u8`: 128 is 0 dB, each byte a sixteenth of one. */
export const ZDR_STEP_DB = 1 / 16;
/** `shear-u8` and `divshear-u8`: 128 is 0, each byte this much per second. */
export const SHEAR_STEP_S = 1e-4;
export const DIVSHEAR_STEP_S = 2e-4;

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
  quantity: "DBZH" | "VRADH" | "RHOHV" | "ZDR" | "SHEAR" | "DIVSHEAR";
  encoding: Encoding;
  /** What the radar itself called the moment, `URHOHV` for an unfiltered coefficient; absent on older objects. */
  source_quantity?: string | null;
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

/**
 * What one bin holds: a value, or why it has none. `too_weak` is a
 * coefficient's echo too faint to read, `no_estimate` and `masked` a shear's
 * or divergence's 0 and 1.
 */
export type BinReading =
  | { kind: "unmeasured" }
  | { kind: "no_echo" }
  | { kind: "unresolved" }
  | { kind: "too_weak" }
  | { kind: "no_estimate" }
  | { kind: "masked" }
  | { kind: "value"; value: number };

/** A bin's byte as what it means: dBZ, m/s, the coefficient, dB, or 1/s. */
export function readBin(encoding: Encoding, byte: number): BinReading {
  switch (encoding) {
    case RVP6:
      if (byte === 255) return { kind: "unmeasured" };
      if (byte === 0) return { kind: "no_echo" };
      return { kind: "value", value: byte / 2 - 32.5 };
    case RHOHV:
      if (byte === 0 || byte === 255) return { kind: "unmeasured" };
      if (byte === 1) return { kind: "too_weak" };
      return { kind: "value", value: RHOHV_FLOOR + (byte - 2) * RHOHV_STEP };
    case ZDR:
      if (byte === 0 || byte === 255) return { kind: "unmeasured" };
      if (byte === 1) return { kind: "no_echo" };
      return { kind: "value", value: (byte - 128) * ZDR_STEP_DB };
    case SHEAR:
    case DIVSHEAR:
      if (byte === 0 || byte === 255) return { kind: "no_estimate" };
      if (byte === 1) return { kind: "masked" };
      return { kind: "value", value: (byte - 128) * (encoding === SHEAR ? SHEAR_STEP_S : DIVSHEAR_STEP_S) };
    default:
      if (byte === VRAD_NOT_MEASURED) return { kind: "unmeasured" };
      if (byte === VRAD_NO_ECHO) return { kind: "no_echo" };
      if (byte === VRAD_UNRESOLVED) return { kind: "unresolved" };
      return { kind: "value", value: (byte - VRAD_ZERO) * VRAD_STEP_M_S };
  }
}

/** A velocity in m/s as the byte `vrad-u8` gives it, clipped to the bytes that hold one. */
export function velocityByte(metresPerSecond: number): number {
  return Math.min(254, Math.max(2, Math.round(metresPerSecond / VRAD_STEP_M_S) + VRAD_ZERO));
}
