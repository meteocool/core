/**
 * Fetching and unpacking the radar volume behind the cutaway view.
 *
 * Everything else the cell popup draws is inferred from KONRAD3D's seven or so
 * numbers of vertical structure: `cellVolume.ts` reuses one measured outline at
 * every height and fits a profile to it, which is honest about what it knows
 * and cannot, by construction, lean. This is the other kind of picture. The
 * bytes here are a real 3D field -- the polar sweeps, resampled onto one map
 * tile of sky, about 26 by 26 by 16 km -- so a core hanging downshear out over
 * its own inflow is in the data rather than in the renderer's imagination.
 *
 * ## Two channels, and why the second one matters more than it looks
 *
 * Each voxel is two bytes: reflectivity and confidence. Confidence is how well
 * the radar network actually illuminated that voxel -- one minus the product of
 * the misses over every sweep of every site that could reach it. It is zero
 * where no beam went: past the last range bin, and in the cone of silence
 * directly above each radar, where the antenna cannot tilt steeply enough.
 *
 * The renderer multiplies opacity by it. That is the whole mechanism by which
 * this view stays honest: unsampled air fades out instead of ending in a crisp
 * surface, and the column over a radar dissolves rather than appearing as a
 * hole punched through the storm. A caption saying "coverage is worse at range"
 * under a confident-looking cloud would not do the same job, because nobody
 * reads the caption over the render.
 *
 * ## The wire format
 *
 * `MCVX`, a version, a JSON header and then the voxels as interleaved bytes,
 * gzipped whole and served with `Content-Encoding: gzip` -- so the browser has
 * already unwrapped it by the time this sees it and the page ships no
 * decompressor of its own.
 */
import type { CellVolume } from "../api";
import { tileBaseUrl } from "../urls";
import { tracked } from "./progress";
import { timedFetch } from "./timedFetch";
import { locateStorm, STORM_DBZ } from "./stormFrame";
import { parentOf, tileCode } from "./volumeBox";

const MAGIC = 0x5856434d; // "MCVX", little-endian

/** What the header says about the box, once it has been read off the wire. */
export interface CutawayHeader {
  code: string;
  reference_time: string;
  /** Where the box is centred: its tile's middle in Mercator, or before tiles the storm's peak. */
  lon: number;
  lat: number;
  nx: number;
  ny: number;
  nz: number;
  /** Voxel size in metres, x then y then z. */
  step_m: [number, number, number];
  /** The box's corner relative to its centre, in metres. */
  origin_m: [number, number, number];
  /** Reflectivity is `byte / dbz_scale + dbz_floor`. */
  dbz_floor: number;
  dbz_scale: number;
  /** Which radars contributed, by EUMETNET node code (older volumes: DWD's bare short name). */
  sites: string[];
  /** Mean confidence through the 3-to-8 km layer, 0 to 1. */
  coverage: number;
  /** The network whose composite the core was found in; absent on older volumes. */
  network?: string | null;
  /** 1: drawn but not openable; 2: the cutaway opens. Absent on older volumes, which were all openable. */
  tier?: number | null;
  /** The newest and the oldest sweep in the box, ISO; absent on older volumes. */
  scanned_at?: string | null;
  oldest_scan_at?: string | null;
  /** The Web Mercator tile the box fills, z, x, y; absent on volumes from before tiles. */
  tile?: [number, number, number] | null;
  /**
   * Voxels at each end of each axis that are the neighbouring tiles' ground:
   * sampled, so the field interpolates across a seam, but never drawn as
   * this box. Absent on volumes from before tiles, which have none.
   */
  apron?: [number, number, number] | null;
}

export interface Cutaway {
  header: CutawayHeader;
  /** Interleaved RG bytes, x fastest, ready for `texImage3D` unchanged. */
  voxels: Uint8Array;
  /** The box's size in metres, which is what the ray marches through. */
  extentM: [number, number, number];
  /**
   * Where the storm actually is inside the box, in kilometres from its centre.
   *
   * The box is a fixed 40 by 40 by 16 km around the cell's centroid, and a
   * storm rarely fills it -- a camera framed on the box draws most cells as a
   * speck in a lot of empty air. These two put the camera on the weather
   * instead, which is the same problem `CellModel3D` solves with its frame.
   * See `locateStorm`.
   */
  centreKm: [number, number, number];
  halfKm: [number, number, number];
}

/** How big the box is on each axis, in metres, apron included: the texture's extent. */
function extentOf(header: CutawayHeader): [number, number, number] {
  return [
    header.nx * header.step_m[0],
    header.ny * header.step_m[1],
    header.nz * header.step_m[2],
  ];
}

/** `stormDbz` is what the storm's footprint is measured above; see `locateStorm`. */
export function decodeCutaway(buffer: ArrayBuffer, stormDbz = STORM_DBZ): Cutaway {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("not a volume");
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`unknown volume version ${version}`);

  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength)),
  ) as CutawayHeader;

  const voxels = new Uint8Array(buffer, 12 + headerLength);
  const wanted = header.nx * header.ny * header.nz * 2;
  if (voxels.length !== wanted) {
    throw new Error(`volume is ${voxels.length} bytes, header wants ${wanted}`);
  }
  return cutawayOf(header, voxels, stormDbz);
}

/** A volume from its header and voxels, with its extent and its storm's frame worked out. */
function cutawayOf(header: CutawayHeader, voxels: Uint8Array, stormDbz = STORM_DBZ): Cutaway {
  return { header, voxels, extentM: extentOf(header), ...locateStorm(header, voxels, stormDbz) };
}

/**
 * A volume that is not there any more: past its retention, or never built.
 *
 * Told apart from a download that failed, which a link to the storm should
 * wait out rather than report as the storm being gone. The bucket answers
 * 403 rather than 404 for a key it does not have when listing is not
 * allowed, so both mean this.
 */
export class VolumeGone extends Error {
  /** Carried for the reports, which group by it (lib/shownFailure.ts). */
  readonly status: number;

  constructor(path: string, status: number) {
    super(`volume ${path}: ${status}`);
    this.name = "VolumeGone";
    this.status = status;
  }
}

/** Any other answer that was not the volume. */
class VolumeRefused extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`volume ${path}: ${status}`);
    this.name = "VolumeRefused";
    this.status = status;
  }
}

/**
 * Pull one cell's volume down.
 *
 * The path comes from the API, bucket included, and the base is the one the
 * rendered tiles already use -- so nothing here guesses a URL. A cell whose
 * volume was never built carries no path, and the caller never gets this far.
 */
export function loadCutaway(
  volume: CellVolume & { seed_dbz?: number | null },
  signal?: AbortSignal,
): Promise<Cutaway> {
  return tracked(volume.path, async () => {
    const response = await timedFetch(`${tileBaseUrl}/${volume.path}`, { signal });
    if (response.status === 403 || response.status === 404) throw new VolumeGone(volume.path, response.status);
    if (!response.ok) throw new VolumeRefused(volume.path, response.status);
    // The threshold the list measured the storm at, so the framing finds the
    // same storm; a cell's volume does not carry one.
    return decodeCutaway(await response.arrayBuffer(), volume.seed_dbz ?? STORM_DBZ);
  });
}

/** The zoom a storm's cores are boxed at, finer than the rest of it; see the worker's `CORE_ZOOM`. */
const CORE_ZOOM = 11;

/**
 * A volume for the panels to show: the volume itself, or for a core's tile,
 * its parent made of it and its three siblings (`parentOf`).
 *
 * The map draws each tile on its own; this is only for the panel's window on
 * the storm, where 13 km is too narrow to see a core in. The siblings are
 * named from the opened tile's own path, as the worker files them: same scan,
 * same network. One that is not there is empty air, and one that fails to
 * load leaves the opened tile to show alone.
 */
export async function loadOpenedCutaway(
  volume: CellVolume & { seed_dbz?: number | null },
  signal?: AbortSignal,
): Promise<Cutaway> {
  const own = await loadCutaway(volume, signal);
  const tile = own.header.tile;
  if (!tile || tile[0] < CORE_ZOOM || !volume.path.includes(own.header.code)) return own;
  const [z, x, y] = tile;
  const quad = [[x & ~1, y & ~1], [x | 1, y & ~1], [x & ~1, y | 1], [x | 1, y | 1]];
  try {
    const children = await Promise.all(quad.map(async ([cx, cy]) => {
      if (cx === x && cy === y) return own;
      const path = volume.path.replace(own.header.code, tileCode(z, cx, cy));
      try {
        return await loadCutaway({ ...volume, path }, signal);
      } catch (error) {
        if (error instanceof VolumeGone) return null;
        throw error;
      }
    }));
    const stormDbz = volume.seed_dbz ?? STORM_DBZ;
    return parentOf(own, children, (header, voxels) => cutawayOf(header, voxels, stormDbz));
  } catch (error) {
    if (signal?.aborted) throw error;
    return own;
  }
}
