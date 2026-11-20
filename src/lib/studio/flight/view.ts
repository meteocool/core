/**
 * Where the eye is in a flight, and what it sees of the aircraft.
 *
 * Two cameras look at the same aircraft. From the cockpit, the eye sits in
 * the captain's seat and turns with the aircraft, and the head turns on top
 * of that as the mouse asks. From outside, it stands off the aircraft and
 * turns round it, level whatever the aircraft does, so a bank is seen as one.
 *
 * Each has two halves, worked out together here so they cannot disagree: how
 * the map's camera stands in the world (a heading, a pitch, a roll, and how
 * far from the aircraft), which draws the ground and the storms; and the
 * aircraft's own vertices taken straight to that camera, which draws the
 * aircraft (layers/aircraftLayer.ts). The second never goes through the
 * map's coordinates: a cockpit is a metre from the eye, and the map counts
 * in fractions of the Earth.
 *
 * Frames: the aircraft's is forward, right, down, in metres; the world's
 * north, east, down. Angles in degrees: nose up and right wing down positive.
 */

export type Vec3 = [number, number, number];
/** Rows. */
export type Mat3 = [Vec3, Vec3, Vec3];

export interface Attitude { heading: number; pitch: number; roll: number }

/** Which way the head is turned from the nose, or the eye stands round the aircraft. */
export interface Look { yaw: number; pitch: number }

const RADIANS = Math.PI / 180;

/** The turn that takes the aircraft's frame to the world's: heading, then pitch, then roll. */
export function rotation({ heading, pitch, roll }: Attitude): Mat3 {
  const [ch, sh] = [Math.cos(heading * RADIANS), Math.sin(heading * RADIANS)];
  const [cp, sp] = [Math.cos(pitch * RADIANS), Math.sin(pitch * RADIANS)];
  const [cr, sr] = [Math.cos(roll * RADIANS), Math.sin(roll * RADIANS)];
  return [
    [ch * cp, ch * sp * sr - sh * cr, ch * sp * cr + sh * sr],
    [sh * cp, sh * sp * sr + ch * cr, sh * sp * cr - ch * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const cell = (i: number, j: number) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return [0, 1, 2].map((i) => [cell(i, 0), cell(i, 1), cell(i, 2)]) as Mat3;
}

export const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Mat3;

export const apply = (m: Mat3, [x, y, z]: Vec3): Vec3 => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z,
];

/** The heading, pitch and roll a turn is; `rotation` the other way. */
export function attitudeOf(m: Mat3): Attitude {
  return {
    heading: (Math.atan2(m[1][0], m[0][0]) / RADIANS + 360) % 360,
    pitch: Math.asin(Math.min(1, Math.max(-1, -m[2][0]))) / RADIANS,
    roll: Math.atan2(m[2][1], m[2][2]) / RADIANS,
  };
}

/** A camera on the aircraft: how it stands in the world, and the aircraft as it sees it. */
export interface Eye extends Attitude {
  /** Where it stands from the aircraft's own middle, metres. */
  north: number;
  east: number;
  up: number;
  /** The aircraft's frame to the camera's, for WebGL: a 4x4, columns first, looking down -z with y up. */
  modelView: number[];
  /** Where it stands in the aircraft's own frame, metres forward, right and down. */
  at: Vec3;
}

function eyeOf(camera: Mat3, aircraft: Mat3, offset: Vec3): Eye {
  const back = transpose(camera);
  const turn = multiply(back, aircraft);
  const [fx, fy, fz] = apply(back, offset);
  // The camera's forward, right, down as WebGL's -z, x, -y.
  const rows = [
    [turn[1][0], turn[1][1], turn[1][2], -fy],
    [-turn[2][0], -turn[2][1], -turn[2][2], fz],
    [-turn[0][0], -turn[0][1], -turn[0][2], fx],
    [0, 0, 0, 1],
  ];
  const modelView = [0, 1, 2, 3].flatMap((column) => rows.map((row) => row[column]));
  return {
    ...attitudeOf(camera), north: offset[0], east: offset[1], up: -offset[2], modelView, at: apply(transpose(aircraft), offset),
  };
}

/** From a seat: `seat` in the aircraft's frame, the head turned by `look`. */
export function cockpitEye(attitude: Attitude, look: Look, seat: Vec3): Eye {
  const aircraft = rotation(attitude);
  const camera = multiply(aircraft, rotation({ heading: look.yaw, pitch: look.pitch, roll: 0 }));
  return eyeOf(camera, aircraft, apply(aircraft, seat));
}

/**
 * From outside, `distance` metres off and looking at the aircraft: `look.yaw`
 * round it from behind (0 is the view over its tail), `look.pitch` above it
 * (negative looks down on it). Level: it follows the heading and nothing else.
 */
export function outsideEye(attitude: Attitude, look: Look, distance: number): Eye {
  const aircraft = rotation(attitude);
  const camera = rotation({ heading: attitude.heading + look.yaw, pitch: look.pitch, roll: 0 });
  const [n, e, d] = apply(camera, [distance, 0, 0]);
  return eyeOf(camera, aircraft, [-n, -e, -d]);
}

/**
 * Where a point of the world is in a camera's picture: across and down it,
 * 0 to 1 each, and how far in front, metres. `offset` is the point from the
 * camera, north, east and down; null for one behind it.
 */
export function seenFrom(camera: Attitude, offset: Vec3, fov: number, aspect: number): { x: number; y: number; ahead: number } | null {
  const [forward, right, down] = apply(transpose(rotation(camera)), offset);
  if (forward <= 1) return null;
  const half = Math.tan((fov * RADIANS) / 2);
  return { x: 0.5 + (0.5 * right) / (forward * half * aspect), y: 0.5 + (0.5 * down) / (forward * half), ahead: forward };
}

/**
 * The way a point of a camera's picture is looked along: `seenFrom` the
 * other way round. The point is across and down the picture, 0 to 1 each;
 * the answer is in the frame the camera's attitude is given in (the
 * aircraft's, for a head turned in its seat), and reaches a metre ahead of
 * the camera.
 */
export function lookedAlong(camera: Attitude, x: number, y: number, fov: number, aspect: number): Vec3 {
  const half = Math.tan((fov * RADIANS) / 2);
  return apply(rotation(camera), [1, (2 * x - 1) * half * aspect, (2 * y - 1) * half]);
}

/** A direction in the world, as the aircraft has it. */
export function inAircraft(attitude: Attitude, world: Vec3): Vec3 {
  return apply(transpose(rotation(attitude)), world);
}

/** WebGL's perspective: a 4x4, columns first. `fov` is the vertical one, degrees. */
export function perspective(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan((fov * RADIANS) / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}
