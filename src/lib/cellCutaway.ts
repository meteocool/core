/**
 * Fetching and unpacking the radar volume behind the cutaway view.
 *
 * Everything else the cell popup draws is inferred from KONRAD3D's seven or so
 * numbers of vertical structure: `cellVolume.ts` reuses one measured outline at
 * every height and fits a profile to it, which is honest about what it knows
 * and cannot, by construction, lean. This is the other kind of picture. The
 * bytes here are a real 3D field -- DWD's polar sweeps, resampled onto a 40 by
 * 40 by 16 km grid around the storm -- so a core hanging downshear out over its
 * own inflow is in the data rather than in the renderer's imagination.
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

const MAGIC = 0x5856434d; // "MCVX", little-endian

/** What the header says about the box, once it has been read off the wire. */
export interface CutawayHeader {
  code: string;
  reference_time: string;
  /** Where the box is centred, which is the cell's own centroid. */
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
  /** Which radars contributed, by DWD short name. */
  sites: string[];
  /** Mean confidence through the 3-to-8 km layer, 0 to 1. */
  coverage: number;
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
   */
  centreKm: [number, number, number];
  halfKm: [number, number, number];
}

/**
 * Below this a voxel is drizzle, clutter or the far fringe of the anvil, and
 * including it in the framing would pull the camera back for nothing.
 *
 * Above the renderer's own floor rather than equal to it: the faintest echo
 * the shader draws is nearly transparent, so framing on it would leave the
 * storm small inside a margin of air the reader cannot see.
 */
export const FRAMING_DBZ = 20;

/** The smallest half-extent worth framing, so a tiny cell is not magnified absurdly. */
const MIN_HALF_KM = 4;

/**
 * Find the storm inside the box.
 *
 * One pass over 819k voxels, which is a few milliseconds once, against a
 * picture that is redrawn sixty times a second for as long as the panel is
 * open.
 */
function locate(header: CutawayHeader, voxels: Uint8Array): {
  centreKm: [number, number, number];
  halfKm: [number, number, number];
} {
  const floor = (FRAMING_DBZ - header.dbz_floor) * header.dbz_scale;
  let minX = header.nx, minY = header.ny, minZ = header.nz;
  let maxX = -1, maxY = -1, maxZ = -1;

  for (let z = 0; z < header.nz; z += 1) {
    for (let y = 0; y < header.ny; y += 1) {
      const row = (z * header.ny + y) * header.nx * 2;
      for (let x = 0; x < header.nx; x += 1) {
        const at = row + x * 2;
        // Confidence zero means nothing was measured there, whatever the other
        // byte says, so it must not drag the framing outwards.
        if (voxels[at] < floor || voxels[at + 1] === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }

  if (maxX < 0) {
    // Nothing above the floor: an empty box, which happens when a storm
    // collapses between the run and the build. Frame the whole thing.
    return {
      centreKm: [0, 0, 0],
      halfKm: [
        (header.nx * header.step_m[0]) / 2000,
        (header.ny * header.step_m[1]) / 2000,
        (header.nz * header.step_m[2]) / 2000,
      ],
    };
  }

  const span = (lo: number, hi: number, count: number, step: number): [number, number] => {
    // Voxel centres, in kilometres from the box's own centre.
    const low = (lo + 0.5 - count / 2) * (step / 1000);
    const high = (hi + 0.5 - count / 2) * (step / 1000);
    return [(low + high) / 2, Math.max((high - low) / 2, MIN_HALF_KM)];
  };
  const [cx, hx] = span(minX, maxX, header.nx, header.step_m[0]);
  const [cy, hy] = span(minY, maxY, header.ny, header.step_m[1]);
  const [cz, hz] = span(minZ, maxZ, header.nz, header.step_m[2]);
  return { centreKm: [cx, cy, cz], halfKm: [hx, hy, hz] };
}

/** How big the box is on each axis, in metres. */
function extentOf(header: CutawayHeader): [number, number, number] {
  return [
    header.nx * header.step_m[0],
    header.ny * header.step_m[1],
    header.nz * header.step_m[2],
  ];
}

export function decodeCutaway(buffer: ArrayBuffer): Cutaway {
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
  return { header, voxels, extentM: extentOf(header), ...locate(header, voxels) };
}

/**
 * Pull one cell's volume down.
 *
 * The path comes from the API, bucket included, and the base is the one the
 * rendered tiles already use -- so nothing here guesses a URL. A cell whose
 * volume was never built carries no path, and the caller never gets this far.
 */
export function loadCutaway(volume: CellVolume, signal?: AbortSignal): Promise<Cutaway> {
  return tracked(volume.path, async () => {
    const response = await fetch(`${tileBaseUrl}/${volume.path}`, { signal });
    if (!response.ok) throw new Error(`volume ${volume.path}: ${response.status}`);
    return decodeCutaway(await response.arrayBuffer());
  });
}
