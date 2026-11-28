/**
 * A storm's volume as a cloud of points: the `points` style (lib/cloudStyle.ts).
 *
 * Every other style marches a ray through the field and fills in what lies
 * between its samples. This draws the samples: one dot a voxel, in its
 * reflectivity's colour, larger and more solid the stronger the echo. What
 * is between two dots is left empty, so a storm is see-through without a
 * peel or a cut, and its core is where the dots are large and close.
 *
 * ## No geometry
 *
 * The dots have no vertex buffer. The volume is already a 3D texture for the
 * raymarcher, so a vertex is only its number: the shader turns `gl_VertexID`
 * into a voxel, reads the field there, and puts whatever the style does not
 * draw outside the clip volume. A storm costs nothing more to hold in this
 * style than in any other, and nothing is uploaded when the style changes.
 *
 * ## Order
 *
 * The dots blend, so they have to be drawn far to near. On a regular grid
 * that needs no sort: walking each axis from the end the eye is further from
 * visits the voxels back to front (`pointGrid`'s `flip`), and the shader
 * numbers them so.
 *
 * ## How many
 *
 * From far off a voxel is less than a pixel, and a dot for each is a solid
 * smear that costs a vertex a voxel. So the dots are thinned until they
 * stand a few pixels apart, in two steps. The grid is walked at every
 * second, fourth or eighth voxel (`pointStride`), each dot read from the
 * field between the voxels it stands for: that is what saves the vertices,
 * and it stops at half the distance wanted. The rest is left to each dot,
 * which is kept or dropped by a number of its own against how close its
 * neighbours are on screen where it stands, and drawn larger for the ones
 * dropped. A tile has one stride and its neighbour may have another, but a
 * dot's own measure runs smoothly across both, so the scatter is as dense
 * either side of a seam, and thins evenly from the foreground to the horizon.
 *
 * Upwards the grid is thinned a quarter as much (`heightStride`). A volume
 * is a few dozen levels tall and each stands several voxels' width above
 * the last once the map has stretched it, so levels left out as freely as
 * columns are leave a storm seen from the side as a stack of stripes.
 */
import type { BoxPart } from "../lib/volumeBox";

/** The least two dots stand apart on screen, in pixels: closer, and some are left out. */
const SPACING_PX = 3.5;
/** The coarsest the grid is thinned to, in voxels a dot. */
const STRIDE_MAX = 8;
/** The most dots one tile is drawn as; over it, the grid is thinned further. */
export const POINTS_MAX = 600_000;
/** A dot's width against the gap between two: the faintest echo, and the strongest. */
const FILL: [number, number] = [0.34, 0.92];
/** How opaque a dot is, the faintest and the strongest. */
const SOLID: [number, number] = [0.42, 1];
/** How far a dot stands from its voxel's middle at most, in gaps between two: enough that the rows do not line up into moiré. */
const JITTER = 0.7;

/** How many voxels a dot stands for along each axis, for voxels this many pixels across. */
export function pointStride(voxelPx: number): number {
  if (!(voxelPx > 0)) return STRIDE_MAX;
  let stride = 1;
  while (stride < STRIDE_MAX && voxelPx * stride < SPACING_PX / 2) stride *= 2;
  return stride;
}

/** How many levels a dot stands for, where it stands for this many voxels along the ground. */
export const heightStride = (stride: number): number => Math.max(1, Math.floor(stride / 4));

/** The dots of one box: where the grid starts, how many along each axis, how many voxels each stands for, and which axes are walked from their far end. */
export interface PointGrid {
  start: [number, number, number];
  count: [number, number, number];
  flip: [number, number, number];
  stride: [number, number, number];
  total: number;
}

/**
 * The grid of dots over the drawn part of a volume, thinned to `stride` and
 * further while it is over `POINTS_MAX`, ordered for an eye at `eye` in the
 * volume's unit cube.
 */
export function pointGrid(
  size: readonly [number, number, number], box: BoxPart, stride: number, eye: readonly [number, number, number],
): PointGrid {
  for (let step = Math.max(1, stride); ; step *= 2) {
    const steps: [number, number, number] = [step, step, heightStride(step)];
    const start = [0, 1, 2].map((axis) => Math.floor((box.min[axis] * size[axis]) / steps[axis]) * steps[axis]) as [number, number, number];
    const count = [0, 1, 2].map((axis) => Math.max(
      0, Math.ceil((Math.min(Math.ceil(box.max[axis] * size[axis]), size[axis]) - start[axis]) / steps[axis]),
    )) as [number, number, number];
    const total = count[0] * count[1] * count[2];
    if (total > POINTS_MAX && step < STRIDE_MAX) continue;
    // Far to near: from the low end where the eye is past the middle, from the high end otherwise.
    const flip = [0, 1, 2].map((axis) => (eye[axis] < (box.min[axis] + box.max[axis]) / 2 ? 1 : 0)) as [number, number, number];
    return { start, count, flip, stride: steps, total };
  }
}

/** A number as a GLSL float. */
const f = (value: number): string => value.toFixed(3);

export const pointsVertex = (planes: number) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform mat4 uForward;     // the unit cube to clip space
uniform vec2 uViewport;
uniform ivec3 uStart;      // the first voxel of the grid
uniform ivec3 uCount;      // how many dots along each axis
uniform ivec3 uFlip;       // 1 where an axis is walked from its far end
uniform ivec3 uStride;     // voxels a dot stands for, along each axis
uniform float uTall;       // how far the next dot up is against the next one along the ground, as the map draws them
uniform vec3 uBoxMin;      // the part of the cube that is drawn
uniform vec3 uBoxMax;
uniform int uPlaneCount;
uniform vec3 uPlaneNormal[${planes}];
uniform vec3 uPlanePoint[${planes}];
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uLow;        // the weakest echo that gets a dot, which the peel raises
uniform float uHigh;       // and where a dot is as large and solid as it gets
uniform float uDim;
uniform float uWeight;     // how much of itself a cloud keeps between two scans
uniform float uSizeMax;    // the largest point this context draws

out vec4 vColour;

vec3 hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yzz) * p.zyx);
}

void main() {
  // Unless it turns out to be a dot: outside the clip volume, so nothing is drawn.
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vColour = vec4(0.0);

  int id = gl_VertexID;
  ivec3 cell = ivec3(id % uCount.x, (id / uCount.x) % uCount.y, id / (uCount.x * uCount.y));
  cell += uFlip * (uCount - 1 - 2 * cell);
  ivec3 voxel = uStart + cell * uStride;
  vec3 size = vec3(textureSize(uVolume, 0));
  // The middle of the voxels it stands for: of one, its own value; of more, the field between them.
  vec3 p = (vec3(voxel) + 0.5 * vec3(uStride)) / size;
  // A tile's apron is its neighbour's to draw: half open, so a dot on the seam is drawn once.
  if (any(lessThan(p, uBoxMin)) || any(greaterThanEqual(p, uBoxMax))) return;

  vec2 raw = texture(uVolume, p).rg;
  float dbz = raw.r * 255.0 / uDbzScale + uDbzFloor;
  if (dbz < uLow || raw.g <= 0.02) return;

  vec3 gap = vec3(uStride) / size;
  // Upwards anywhere in its level: the levels stand further apart than the columns, and would show as rows.
  p += (hash(vec3(voxel)) - 0.5) * vec3(${f(JITTER)}, ${f(JITTER)}, 1.0) * gap;
  for (int k = 0; k < ${planes}; k += 1) {
    if (k >= uPlaneCount) break;
    if (dot(p - uPlanePoint[k], uPlaneNormal[k]) > 0.0) return;
  }

  vec4 clip = uForward * vec4(p, 1.0);
  if (clip.w <= 0.0) return;
  // The gap to the next dot on screen, along whichever of the ground's axes shows more of itself.
  vec2 centre = clip.xy / clip.w;
  vec4 east = clip + uForward[0] * gap.x;
  vec4 north = clip + uForward[1] * gap.y;
  float gapPx = max(
    length((east.xy / max(east.w, 1e-6) - centre) * uViewport),
    length((north.xy / max(north.w, 1e-6) - centre) * uViewport)) * 0.5;

  // Closer than they should stand, only some are drawn: as many as leave the rest that far apart.
  // Counted in all three directions, the one upwards by what it is against the ground's: from above it has no length on screen.
  float keep = gapPx / ${f(SPACING_PX)};
  if (hash(vec3(voxel) + 17.0).x > keep * keep * keep * uTall) return;
  gapPx = max(gapPx, ${f(SPACING_PX)} * pow(uTall, -1.0 / 3.0));

  float strength = clamp((dbz - uLow) / (uHigh - uLow), 0.0, 1.0);
  float wanted = gapPx * mix(${f(FILL[0])}, ${f(FILL[1])}, strength);
  float drawn = clamp(wanted, 1.5, uSizeMax);
  // A dot that cannot be drawn as small as it is, is drawn fainter: the same light, over more pixels.
  float thin = min(1.0, (wanted * wanted) / (drawn * drawn));
  float alpha = mix(${f(SOLID[0])}, ${f(SOLID[1])}, strength) * raw.g * uWeight * uDim * thin;
  vec3 colour = texture(uRamp, vec2(clamp((dbz + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;

  gl_Position = clip;
  gl_PointSize = drawn;
  vColour = vec4(colour * alpha, alpha);
}`;

export const POINTS_FRAGMENT = `#version 300 es
precision highp float;

in vec4 vColour;
out vec4 fragColour;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  // A bead, not a disc: a little darker towards its rim, and soft at it.
  fragColour = vec4(vColour.rgb * (1.0 - 0.3 * r), vColour.a) * (1.0 - smoothstep(0.7, 1.0, r));
}`;
