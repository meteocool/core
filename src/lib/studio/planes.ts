/**
 * Studio's section planes: where each stands, and what it takes away.
 *
 * A plane passes through one point above the map and removes everything on
 * the side it faces, as a section plane does in a CAD program. Upright it is
 * a wall, the cross-section through a storm; level it is a floor or a
 * ceiling, the storm at one height; leaning, anything between. With a
 * thickness it keeps only a slab behind its face, which is a slice lifted out
 * of the storm rather than half of it.
 *
 * Kept apart from the layer that draws them, which needs a GL context: the
 * arithmetic here is what the tests, the links and the keyframes share.
 */

/** Kilometres to a degree of latitude. */
const KM_PER_DEGREE = 111.195;

/** How many planes a scene holds. Each with a thickness is two cuts in the shader. */
export const MAX_PLANES = 3;

/** The tallest a storm's box stands, km: as far up as a level plane is worth moving. */
export const PLANE_TOP_KM = 16;

export interface SectionPlane {
  /** Its own among a scene's, which keyframes follow it by. */
  id: number;
  /** The point it passes through. */
  lon: number;
  lat: number;
  /** How high that point is, km. Nothing to an upright plane, which runs through every height. */
  heightKm: number;
  /** The compass direction the removed side lies in, degrees clockwise from north. */
  facingDeg: number;
  /**
   * How far it leans back from upright: 0 a wall, 90 level with everything
   * above it removed, -90 level with everything below removed.
   */
  tiltDeg: number;
  /** How much is kept behind its face, km; null for everything. */
  slabKm: number | null;
  /** Off, it stays in the scene and cuts nothing. */
  enabled: boolean;
}

/** One half-space taken away: everything on the side `normal` points to, from this point on. */
export interface ClipPlane {
  lon: number;
  lat: number;
  heightKm: number;
  /** East, north, up. Unit length. */
  normal: [number, number, number];
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** A compass direction, folded into [0, 360). */
export function foldDegrees(degrees: number): number {
  // One already there is left exactly as it is: folding costs it its last digit.
  if (degrees >= 0 && degrees < 360) return degrees;
  const folded = ((degrees % 360) + 360) % 360;
  return Object.is(folded, -0) ? 0 : folded;
}

/** The direction a plane faces: east, north, up. */
export function normalOf({ facingDeg, tiltDeg }: Pick<SectionPlane, "facingDeg" | "tiltDeg">): [number, number, number] {
  const facing = radians(facingDeg);
  const tilt = radians(tiltDeg);
  return [Math.sin(facing) * Math.cos(tilt), Math.cos(facing) * Math.cos(tilt), Math.sin(tilt)];
}

/** Whether a plane is level, or near enough that it has no line on the ground to hold it by. */
export const isLevel = (plane: Pick<SectionPlane, "tiltDeg">): boolean => Math.abs(plane.tiltDeg) > 89;

/** A point moved along a direction (east, north, up) by so many kilometres. */
function moved(
  at: { lon: number; lat: number; heightKm: number }, [east, north, up]: readonly number[], km: number,
): { lon: number; lat: number; heightKm: number } {
  return {
    lon: at.lon + (east * km) / (KM_PER_DEGREE * Math.cos(radians(at.lat))),
    lat: at.lat + (north * km) / KM_PER_DEGREE,
    heightKm: at.heightKm + up * km,
  };
}

/**
 * The same plane, pushed along the way it faces: forward eats further into
 * what is kept, backward gives it back.
 */
export function pushed(plane: SectionPlane, km: number): SectionPlane {
  return { ...plane, ...moved(plane, normalOf(plane), km) };
}

/** The same plane, keeping the other side. */
export function flipped(plane: SectionPlane): SectionPlane {
  return { ...plane, facingDeg: foldDegrees(plane.facingDeg + 180), tiltDeg: -plane.tiltDeg };
}

/**
 * What the planes take away, as half-spaces: one for a plane that keeps
 * everything behind it, two for a slab, the second facing back at the first
 * from its far side.
 */
export function clipPlanes(planes: readonly SectionPlane[]): ClipPlane[] {
  return planes.filter((plane) => plane.enabled).flatMap((plane) => {
    const normal = normalOf(plane);
    const face: ClipPlane = { lon: plane.lon, lat: plane.lat, heightKm: plane.heightKm, normal };
    if (plane.slabKm === null) return [face];
    const back = moved(plane, normal, -Math.max(plane.slabKm, 0));
    return [face, { ...back, normal: [-normal[0], -normal[1], -normal[2]] as [number, number, number] }];
  });
}

/** Web Mercator, as the 3D map lays the world out: 0 to 1 across, and 0 to 1 running south. */
export function mercatorOf(lon: number, lat: number): [number, number] {
  return [
    (lon + 180) / 360,
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + radians(lat) / 2))) / 360,
  ];
}

/**
 * A half-space in one cloud's own unit cube, which is where its rays march.
 *
 * `model` puts the cube on the map: it only scales and translates, so the
 * point maps by undoing it, and a normal measured in kilometres becomes one
 * measured in cube units by the size of the cube along each axis. The cube's
 * y runs north though Mercator's runs south, which the model's negative
 * scale has already folded in.
 */
export function carryPlane(
  model: ArrayLike<number>, extentM: readonly number[], plane: ClipPlane,
): { normal: [number, number, number]; point: [number, number, number] } {
  const [x, y] = mercatorOf(plane.lon, plane.lat);
  return {
    normal: [plane.normal[0] * extentM[0], plane.normal[1] * extentM[1], plane.normal[2] * extentM[2]],
    point: [(x - model[12]) / model[0], (y - model[13]) / model[5], (plane.heightKm * 1000) / extentM[2]],
  };
}

/**
 * A new plane where the reader is looking: through the middle of the view,
 * upright and square to the camera so its face is what they see, or level
 * at mid-height.
 */
export function planeAt(
  id: number, view: { lon: number; lat: number; bearing: number }, kind: "upright" | "level",
): SectionPlane {
  return {
    id,
    lon: view.lon,
    lat: view.lat,
    heightKm: kind === "level" ? 4 : 0,
    // The camera looks along its bearing, so the removed side is the one towards it.
    facingDeg: kind === "level" ? 0 : foldDegrees(view.bearing + 180),
    tiltDeg: kind === "level" ? 90 : 0,
    slabKm: null,
    enabled: true,
  };
}

/** The lowest id not taken, so a plane removed and another added does not inherit its keyframes. */
export function nextPlaneId(planes: readonly SectionPlane[], used: Iterable<number> = []): number {
  const taken = new Set([...planes.map((plane) => plane.id), ...used]);
  let id = 1;
  while (taken.has(id)) id += 1;
  return id;
}
