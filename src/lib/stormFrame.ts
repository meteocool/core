/**
 * Where the storm is inside its volume, and where to stand to look at it.
 *
 * A volume is a fixed 40 by 40 by 16 km box around the cell's centroid, and a
 * storm rarely fills it -- a camera framed on the box draws most storms as a
 * speck in a lot of empty air. Both pictures of a storm, the panel's own and
 * the 3D map's on a phone, are framed on what this finds instead.
 *
 * Kept apart from `cellCutaway.ts`, which fetches, so the tests can reach it:
 * framing is what broke silently once already, when the volume list grew to
 * every shower with a core and their boxes filled with neighbouring echo.
 */
import type { Cutaway, CutawayHeader } from "./cellCutaway";

/**
 * Below this a voxel is drizzle, clutter or the far fringe of the anvil, and
 * including it in the framing would pull the camera back for nothing.
 *
 * Above the renderer's own floor rather than equal to it: the faintest echo
 * the shader draws is nearly transparent, so framing on it would leave the
 * storm small inside a margin of air the reader cannot see.
 */
export const FRAMING_DBZ = 20;

/**
 * The threshold a storm's footprint is measured above, when its volume does
 * not say: the backend's default `seed_dbz`, the one `area_km2` is measured at.
 */
export const STORM_DBZ = 25;

/** The smallest half-extent worth framing, so a tiny cell is not magnified absurdly. */
const MIN_HALF_KM = 4;

export interface StormExtent {
  /** The storm's middle, in kilometres from the box's centre. */
  centreKm: [number, number, number];
  /** Half its size on each axis, in kilometres. */
  halfKm: [number, number, number];
}

/**
 * Find the storm inside the box.
 *
 * The storm is the one the box was built around: the connected footprint,
 * above `stormDbz` in the column maximum, that reaches nearest the box's
 * centre. Not everything in the box above `FRAMING_DBZ`: a weak shower stands
 * in a field of other weak echo, and the bounding box of all of it is the
 * whole box -- the camera then frames 40 km and the storm is a speck again.
 * Its height is the echo above `FRAMING_DBZ` over that footprint, which is
 * how high it is drawn.
 *
 * With nothing above `stormDbz`, everything above `FRAMING_DBZ`; with nothing
 * above that either -- a storm that collapsed between the run and the build --
 * the whole box.
 *
 * One pass over 819k voxels and a flood over the 26k columns, which is a few
 * milliseconds once, against a picture redrawn sixty times a second.
 */
export function locateStorm(header: CutawayHeader, voxels: Uint8Array, stormDbz = STORM_DBZ): StormExtent {
  const { nx, ny, nz } = header;
  const columns = nx * ny;
  const toByte = (dbz: number) => (dbz - header.dbz_floor) * header.dbz_scale;
  const edge = toByte(Math.min(FRAMING_DBZ, stormDbz));

  // Each column's strongest measured echo; -1 where nothing was measured.
  // Confidence zero means no beam went there, whatever the other byte says,
  // so it must not drag the framing outwards.
  const strongest = new Int16Array(columns).fill(-1);
  for (let z = 0; z < nz; z += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = (z * columns + column) * 2;
      if (voxels[at + 1] !== 0 && voxels[at] > strongest[column]) strongest[column] = voxels[at];
    }
  }

  const footprint = stormFootprint(strongest, nx, ny, toByte(stormDbz))
    ?? anyAbove(strongest, edge);
  if (!footprint) {
    return {
      centreKm: [0, 0, 0],
      halfKm: [
        (nx * header.step_m[0]) / 2000,
        (ny * header.step_m[1]) / 2000,
        (nz * header.step_m[2]) / 2000,
      ],
    };
  }

  let minX = nx, minY = ny, minZ = nz;
  let maxX = -1, maxY = -1, maxZ = -1;
  for (let column = 0; column < columns; column += 1) {
    if (!footprint[column]) continue;
    const x = column % nx;
    const y = (column - x) / nx;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let z = 0; z < nz; z += 1) {
      const at = (z * columns + column) * 2;
      if (voxels[at] < edge || voxels[at + 1] === 0) continue;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const span = (lo: number, hi: number, count: number, step: number): [number, number] => {
    // Voxel centres, in kilometres from the box's own centre.
    const low = (lo + 0.5 - count / 2) * (step / 1000);
    const high = (hi + 0.5 - count / 2) * (step / 1000);
    return [(low + high) / 2, Math.max((high - low) / 2, MIN_HALF_KM)];
  };
  const [cx, hx] = span(minX, maxX, nx, header.step_m[0]);
  const [cy, hy] = span(minY, maxY, ny, header.step_m[1]);
  const [cz, hz] = span(minZ, maxZ, nz, header.step_m[2]);
  return { centreKm: [cx, cy, cz], halfKm: [hx, hy, hz] };
}

/**
 * The columns of the storm the box is centred on: above `floor`, touching
 * (corners count), grown from the qualifying column nearest the centre. Null
 * when no column qualifies.
 */
function stormFootprint(strongest: Int16Array, nx: number, ny: number, floor: number): Uint8Array | null {
  let seed = -1;
  let nearest = Infinity;
  for (let column = 0; column < strongest.length; column += 1) {
    if (strongest[column] < 0 || strongest[column] < floor) continue;
    const x = column % nx;
    const y = (column - x) / nx;
    const distance = (x + 0.5 - nx / 2) ** 2 + (y + 0.5 - ny / 2) ** 2;
    if (distance < nearest) {
      nearest = distance;
      seed = column;
    }
  }
  if (seed < 0) return null;

  const inside = new Uint8Array(strongest.length);
  const queue = new Int32Array(strongest.length);
  let head = 0;
  let tail = 0;
  inside[seed] = 1;
  queue[tail++] = seed;
  while (head < tail) {
    const column = queue[head++];
    const x = column % nx;
    const y = (column - x) / nx;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ty = y + dy;
      if (ty < 0 || ty >= ny) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const tx = x + dx;
        if (tx < 0 || tx >= nx) continue;
        const next = ty * nx + tx;
        if (inside[next] || strongest[next] < 0 || strongest[next] < floor) continue;
        inside[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return inside;
}

/** Every column with measured echo at or above `floor`; null when there is none. */
function anyAbove(strongest: Int16Array, floor: number): Uint8Array | null {
  const inside = new Uint8Array(strongest.length);
  let any = false;
  for (let column = 0; column < strongest.length; column += 1) {
    if (strongest[column] < 0 || strongest[column] < floor) continue;
    inside[column] = 1;
    any = true;
  }
  return any ? inside : null;
}

/** How much of the room the storm is given, leaving it a margin. */
export const OPEN_FILL = 0.9;

/** MapLibre's vertical field of view, radians: its default, which the 3D map keeps. */
const MAPLIBRE_FOV = (36.8699 * Math.PI) / 180;

/** Metres per pixel at zoom 0 on the equator, for MapLibre's 512px tiles. */
export const WORLD_METRES_AT_ZOOM_0 = 40_075_016.686 / 512;

/** Kilometres in a degree of latitude, and of longitude at the equator; close enough to frame with. */
export const KM_PER_DEGREE = 111.32;

/** The part of the screen a storm is framed into, in CSS pixels. */
export interface FramingRoom {
  width: number;
  height: number;
  /** Where the room starts below the controls along the top. */
  top: number;
  /** Where it ends above the sheet. */
  bottom: number;
}

/** A MapLibre camera, bar the bearing, which the caller turns to face the cut. */
export interface FramingCamera {
  lon: number;
  lat: number;
  /** MapLibre's zoom, a level below the flat map's. */
  zoom: number;
  /** How far below the middle of the screen the camera's centre is drawn. */
  offsetY: number;
}

/**
 * Where to stand for a storm's cut to fill the room, square on to it and from
 * low down -- the 3D map's picture of an opened storm on a phone.
 *
 * `directionDeg` is the compass direction the cut runs along. The storm's
 * width is what the cut shows of it, its extent along the plane, and its
 * height is from the ground to its top; the storm's centre is measured from
 * the middle of the box, which stands on the ground.
 */
export function framingCamera(
  cutaway: Pick<Cutaway, "header" | "centreKm" | "halfKm" | "extentM">,
  directionDeg: number,
  room: FramingRoom,
  pitchDeg: number,
  maxZoom: number,
): FramingCamera {
  const { header, centreKm, halfKm, extentM } = cutaway;
  const latRad = (header.lat * Math.PI) / 180;
  const lon = header.lon + centreKm[0] / (KM_PER_DEGREE * Math.cos(latRad));
  const lat = header.lat + centreKm[1] / KM_PER_DEGREE;
  const along = (directionDeg * Math.PI) / 180;
  const widthM = 2000 * (halfKm[0] * Math.abs(Math.sin(along)) + halfKm[1] * Math.abs(Math.cos(along)));
  const heightM = extentM[2] / 2 + 1000 * (centreKm[2] + halfKm[2]);

  // Metres per pixel that fit both where the storm will stand. Across, a
  // plane square to the camera is drawn at the scale of the ground under
  // it; upwards it is foreshortened by the tilt.
  const { width, height, top, bottom } = room;
  const tilt = (pitchDeg * Math.PI) / 180;
  const atFoot = Math.max(
    widthM / (width * OPEN_FILL),
    (heightM * Math.sin(tilt)) / ((bottom - top) * OPEN_FILL),
  );
  // The storm's foot, so that the whole of it sits between the controls
  // and the sheet: halfway down that gap, plus half its own height.
  const foot = (top + bottom) / 2 + (heightM * Math.sin(tilt)) / atFoot / 2;
  // A zoom is a scale at the middle of the screen, and at this tilt the
  // scale changes fast up the screen: the ground under a point above the
  // middle is further off, by the ratio of the two rays' cosines to the
  // vertical. Asked for at the middle, a storm standing a hundred pixels
  // higher came out a third smaller than it was meant to.
  const focal = height / 2 / Math.tan(MAPLIBRE_FOV / 2);
  const above = Math.atan((height / 2 - foot) / focal);
  const atMiddle = (atFoot * Math.cos(tilt + above)) / Math.cos(tilt);
  const zoom = Math.min(Math.log2((WORLD_METRES_AT_ZOOM_0 * Math.cos(latRad)) / atMiddle), maxZoom);
  return { lon, lat, zoom, offsetY: foot - height / 2 };
}
