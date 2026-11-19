/**
 * Every storm's volume, drawn into the 3D map, with the one a reader opened cut.
 *
 * `CellCutaway` renders one volume in a panel with a camera of its own, which
 * is the right place to study a storm and the wrong place to see where it is.
 * This puts them all on the map at once: the same field and the same shader,
 * standing on the ground each storm is over, at the scale of the terrain, as
 * a sky of clouds. The one being inspected is sliced along its track, as the
 * panel cuts it; every other one that could be opened is peeled: its faint
 * envelope left out, as far towards the strongest echo as the peel says
 * (lib/peel.ts). A cut shows a storm's core from one side; the peel shows
 * where in the cloud the intensity sits, which is the question a map full
 * of storms is asking. One the radars did not see well enough to open is
 * held whole: its inside is interpolation.
 *
 * ## Styles
 *
 * The same field can be drawn five ways (lib/cloudStyle.ts), and the reader
 * picks: the lit cloud described above, the field as unlit see-through
 * light from its faintest echo up, a surface at every tenth dBZ, nested, or
 * a white cloud in sunlight, plain or with its hull tinted by the column
 * under it. One program draws them all: the ray, the box, the cut and the
 * depth are the same, and only what a sample along the ray adds differs.
 * The peel works on each from its own floor; the cut leaves a flat face in
 * the radar's colours on the cloud, the light and the white cloud, and
 * opens the shells hollow.
 *
 * ## How a Raymarcher Gets onto a MapLibre Map
 *
 * MapLibre has no volume primitive and never will. It has
 * `CustomLayerInterface`, which hands over the GL context and the
 * `modelViewProjectionMatrix` for the frame and leaves the drawing to the
 * layer. A matrix is all a raymarcher needs, because the march happens in the
 * box's own space and the matrix is only used to work out where each ray
 * enters it.
 *
 * ## Why the Box Is a Unit Cube
 *
 * The obvious model matrix leaves the box in Mercator units, where the whole
 * world is 0 to 1 and a 40 km storm is about a thousandth of that. Marching a
 * ray through numbers that small in `highp float` bands visibly. So the model
 * matrix maps the unit cube onto the box instead: the shader marches [0,1] in
 * each axis, the texture lookup is the position itself, and the precision
 * problem never arises.
 *
 * Mercator's y runs south, which is why the scale below is negative on that
 * axis. Without it the storm is mirrored north to south, which looks almost
 * right and is completely wrong.
 *
 * ## Between two scans
 *
 * Studio plays the storms as a film (lib/studio/scene.ts), and the radar
 * sees them every five minutes. Between two scans this draws both: the
 * earlier scan's clouds carried forward along the storms' motion by the
 * share of the five minutes gone, the later one's carried back by the share
 * still to come, so the two stand on top of each other wherever the motion
 * was right (lib/cloudMotion.ts), and each weighted by how near the moment
 * is to its own scan. A storm moves across, and grows or dies where it is,
 * rather than fading out in one place and in at another.
 *
 * Weighted in its density, not in its colour: opacity through a cloud is
 * the exponent of its density summed along the ray, so two copies of one
 * cloud at weights that add to one stop exactly the light the cloud does,
 * where two copies faded in colour would stand half as opaque at the middle
 * of every step, or twice. Its light is its own, unweighted: each copy is
 * shaded as the whole cloud would be, so a storm half way between two scans
 * is no brighter or darker for it. Carried by its model matrix, so a tile
 * moves as a whole box and nothing samples across its seam; one offset and
 * one weight a cloud, both uniforms, so a frame of a blend uploads nothing.
 *
 * The shells are surfaces, and two copies of a surface are two surfaces,
 * not one in between. Both are carried as the clouds are, and only at the
 * middle third of the step do they hand over, each one's surfaces fading by
 * their alpha as the other's come in, so a shell moves with its storm and
 * changes shape once, softly, rather than standing doubled for the whole
 * five minutes.
 *
 * What it costs: every cloud twice, and each copy, half as dense, would
 * march twice as deep into a storm before it is opaque enough to stop, four
 * times the frame. So a copy stops where it has stopped its own share of
 * the light a ray stops at (`OPAQUE`): with the other copy over or under
 * it, nothing past that point could show. Twice the frame, then, for the
 * minutes between two scans.
 *
 * ## Depth
 *
 * The volume is depth-*tested* but does not depth-*write*: terrain and other
 * storms occlude it, and it does not carve holes in whatever is drawn after
 * it. `gl_FragDepth` comes from the point where the ray enters the storm
 * rather than from the fullscreen triangle, or the whole box would sit at one
 * depth and either float in front of everything or vanish behind it.
 *
 * And it is put into the depth range MapLibre is drawing with, by hand.
 * MapLibre draws its 3D layers (the terrain, the extrusions, this) into
 * `[0, 0.995]` or so, not `[0, 1]`, and `glDepthRange` maps only the depth a
 * triangle interpolates: a depth written to `gl_FragDepth` is taken as it is.
 * Written as `[0, 1]`, every storm stood half a percent behind its true depth.
 * Close up that is nothing. Zoomed out, where every depth on screen crowds up
 * against 1, it is more than the gap between a storm and the ground behind
 * it: over the Alps with terrain on, the clouds vanished.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GlMap } from "maplibre-gl";
import { drawnPart, echoPart, overlap } from "../lib/volumeBox";
import type { BoxPart } from "../lib/volumeBox";
import { cameraOf, farToNear } from "../lib/drawOrder";
import { stormsOf, tileEdges, type TileEdges } from "../lib/tileStorms";
import type { Cutaway } from "../lib/cellCutaway";
import { dbzColour } from "../lib/cellVolume";
import { HULL_TINT, SHELL_STEP, SHELL_TOP, STYLE_FIELD } from "../lib/cloudStyle";
import type { CloudStyle } from "../lib/cloudStyle";
import { peelLow, peelShare } from "../lib/peel";
import { carryPlane, MAX_PLANES } from "../lib/studio/planes";
import type { ClipPlane } from "../lib/studio/planes";
import { VERTICAL_SCALE } from "./terrain";

/**
 * Reflectivity below this is drizzle or the fringe of the anvil: where the
 * cloud style starts to show, and what a storm is measured above whatever
 * style it is drawn in (`solidKm2`, `coreDbz`).
 */
const DBZ_LOW = STYLE_FIELD.cloud.floor;
/** Where the echo is as opaque as it gets; see `CellCutaway` for the reasoning. */
const DBZ_HIGH = DBZ_LOW + STYLE_FIELD.cloud.band;
/**
 * How far a scenic sky's cloud may stand out past the echo it is made from
 * (`CloudsLayer.setScenic`): kilometres east-west, north-south and upwards,
 * and from how far below a style's floor it draws. The box a cloud is
 * marched in is that much larger.
 */
const SCENIC_REACH = { km: [6.5, 6.5, 3], dbz: 10 } as const;
/** The styles, as the shader numbers them. */
const STYLE_INDEX: Record<CloudStyle, number> = { cloud: 0, glow: 1, shells: 2, sky: 3, tinted: 4 };
/**
 * How opaque a shell is, the faintest and from `SHELL_SOLID_DBZ` up: the
 * outer ones are tinted glass, so a storm left whole still hints at what is
 * in it, and the rest are solid. Much clearer than this and a rain shield
 * is a dozen panes of glass behind one another, none of them a surface.
 */
const SHELL_ALPHA_MIN = 0.5;
const SHELL_SOLID_DBZ = 40;
/**
 * How much storm the peel stops at, in voxels: the strongest this many are
 * what is left standing. A threshold taken from the single strongest voxel
 * peels down to nothing (one bright pixel of clutter, or a core too small to
 * see from a map), so the stopping point is where this much echo remains.
 * At 250 by 250 by 500 m a voxel, this is about 9 km3 of storm.
 */
const PEEL_CORE_VOXELS = 300;
/** The softness of the peel's edge, in dBZ: as wide as the unpeeled ramp. */
const PEEL_BAND = DBZ_HIGH - DBZ_LOW;
/** How opaque a ray gets before it stops: nothing behind that shows through. */
const OPAQUE = 0.985;
/** Opacity per kilometre of fully dense storm; see the shader's march. */
const OPACITY_PER_KM = 0.62;
/**
 * The same for the glow, far less: light, not a body. At 1.2 the tens of
 * kilometres of weak echo a ray crosses in a rain shield added up to a green
 * wall, and the glow was the cloud without its shading. At this a ray
 * through a whole shield is still a veil, and what shows through it is the
 * light the cores give off (`GLOW_LIGHT`).
 */
const GLOW_OPACITY_PER_KM = 0.4;
/**
 * How much light the glow gives off for the light it stops, the faintest
 * echo and the strongest: weak echo is about as bright as it is opaque, a
 * core several times so, which is what lets it shine through the veil in
 * front of it and bloom where it is thick.
 */
const GLOW_LIGHT: [number, number] = [0.8, 2.6];
/**
 * The same for the sky's white cloud, which is nearly opaque a few hundred
 * metres in, as a real one is; and what its own shadows count it as, less,
 * or every side turned from the sun is black. Strings, to be GLSL floats.
 */
const SKY_OPACITY_PER_KM = "4.5";
const SKY_SHADOW_PER_KM = "1.4";
/**
 * Kilometres to a unit of Mercator, for the ground the sky's noise is laid
 * on: about the scale at mid-latitudes. What matters is that every tile
 * shares the frame, not how true a kilometre it is.
 */
const NOISE_KM_PER_MERCATOR = 30000;
/**
 * The least a storm has to show to be drawn: this much of its silhouette, in
 * km2, at least half opaque at the map's tilt; see `solidKm2`. A 2 by 2 km
 * core stands clear of the basemap at the zoom a region is looked at; below
 * it, what is drawn is a wisp or a tint.
 */
const SOLID_KM2_MIN = 4;
/** The tilt a storm's silhouette is measured at: the one the 3D map opens at. */
const VIEW_PITCH_DEG = 55;
/**
 * Samples along a ray across the whole width of a 160-voxel box: fewer than
 * the panel uses, since this shares a frame. A smaller box gets
 * proportionally fewer, so a ray samples the same distance per step whatever
 * box it crosses: a tile of 104 voxels takes 83. A ray that crosses less of
 * the box takes fewer still; see the shader.
 */
const STEPS = 128;
/** The box `STEPS` is counted for, in voxels across: the 40 km box before tiles. */
const STEPS_VOXELS = 160;
/**
 * How far from an opened storm the cut reaches, in km: every cloud whose box
 * comes this close to where the cut passes through is cut by the same plane.
 *
 * Whatever storm or scan it is from. Cut by storm, a neighbour that the
 * backend counts as a storm of its own (its peak a few dBZ apart, one tile
 * over) stood whole beside the face and hid it, and so did the newer scan's
 * tiles around a storm kept open past its scan. Not every cloud on the map:
 * the cut-away side is half the map, gone. At the tilt a storm opens at the
 * camera stands about 30 km off, so this clears the ground between the two,
 * and puts the edge of what is cut past the sides of the screen.
 */
const CUT_REACH_KM = 40;
/**
 * How many planes the shader cuts one cloud by: Studio's section planes
 * (lib/studio/planes.ts), a slab among them being two.
 */
const CLIP_PLANES = MAX_PLANES * 2;

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * The white cloud's shape and light, as the map draws it: what a point of
 * the radar's field is as cloud (`skyBody` for its shadows, `skyDensity` for
 * what is seen) and the light that reaches it (`skyLight`). The one part of
 * the shader with another to take its place: `CloudsLayer.setScenic`.
 */
const SKY_PLAIN = `/**
 * How much cloud a point is, for its shadows: the inner part of its edge
 * only. The hull that is seen is the edge with billows eaten out of it
 * (skyDensity), and shadows cast by the whole edge fell on it from cloud
 * that was no longer there, which mottled every top grey.
 */
float skyBody(vec3 p) {
  vec2 field = sampleField(p);
  return smoothstep(mix(uLow, uHigh, 0.25), uHigh, field.x) * field.y;
}

/**
 * How much cloud a point is, its edge broken into billows.
 *
 * The radar's field is smooth at the scale of a voxel, and a cloud drawn from
 * it alone is a blob. Two octaves of noise, about 2.5 km and 800 m across,
 * eat into its soft edge and leave its inside solid, so the hull is lumpy as
 * a cumulus is and the storm keeps its shape. Only where the edge is: no
 * noise is worked out inside the cloud or outside it.
 */
float skyDensity(vec3 p, vec2 field) {
  float body = smoothstep(uLow, uHigh, field.x) * field.y;
  if (body <= 0.0 || body >= 1.0) return body;
  vec3 w = worldKm(p);
  float n = 0.6 * noise3(w * vec3(0.4, 0.4, 0.5)) + 0.4 * noise3(w * vec3(1.3, 1.3, 1.5));
  return clamp((body - 0.5 * n) / (1.0 - 0.5 * n), 0.0, 1.0);
}

/**
 * The light that reaches a point of the cloud: the sun's, through what of
 * the cloud stands between them, and the sky's, through what is overhead.
 *
 * Four samples towards the sun, spaced wider as they go out to 3 km, and two
 * straight up: six lookups a step, what the cloud spends on its gradient.
 */
vec3 skyLight(vec3 p, float heightKm, float towardSun) {
  vec3 sun = normalize(SUN);
  float depth = 0.0;
  float last = 0.0;
  for (int k = 0; k < 4; k += 1) {
    float at = 0.25 + 0.2375 * float(k * k + k);
    depth += skyBody(p + sun * at / uExtentKm) * (at - last);
    last = at;
  }
  depth *= ${SKY_SHADOW_PER_KM};
  // Light scattered many times gets further into a cloud than the first
  // bounce does: a second, fainter falloff keeps a deep shadow grey, not black.
  float sunlit = 0.7 * exp(-depth) + 0.3 * exp(-0.15 * depth);
  float over = (skyBody(p + vec3(0.0, 0.0, 0.6 / uExtentKm.z)) * 0.6
    + skyBody(p + vec3(0.0, 0.0, 1.8 / uExtentKm.z)) * 1.2) * ${SKY_SHADOW_PER_KM};
  // The sky lights the top of a cloud, and the ground, darker, its base. Not
  // all of it from straight up: the side of a tower under its own top still
  // sees half the sky, so what is overhead takes only some of it away.
  float open = (0.45 + 0.55 * exp(-0.5 * over)) * mix(0.55, 1.0, clamp(heightKm / 9.0, 0.0, 1.0));
  // A little brighter looking into the sun, where light comes through the edge.
  float phase = 0.88 + 0.55 * pow(max(towardSun, 0.0), 6.0);
  return SUNLIGHT * sunlit * phase * 1.25 + SKYLIGHT * open * 0.5;
}

`;

const fragment = (sky: string) => `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform mat4 uInverse;     // clip space back to the unit cube
uniform mat4 uForward;     // and out again, for the depth of the entry point
uniform vec2 uViewport;
uniform vec3 uExtentKm;    // what one unit of the cube is worth, per axis
uniform int uPlaneCount;   // how many planes cut this cloud: the opened storm's one, or Studio's
uniform vec3 uPlaneNormal[${CLIP_PLANES}];
uniform vec3 uPlanePoint[${CLIP_PLANES}];
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uSteps;
uniform float uLow;        // where the echo starts to show, which the peel raises
uniform float uHigh;       // and where it is as opaque as it gets
uniform int uStyle;        // 0 a lit cloud, 1 unlit light, 2 nested surfaces, 3 a white cloud, 4 tinted; see lib/cloudStyle.ts
uniform float uDim;        // how much of its opacity a storm keeps: less for one not seen well enough to open
uniform float uWeight;     // how much of its density a cloud keeps between two scans; see "Between two scans"
uniform float uOpaque;     // how opaque a ray gets before nothing behind can show: its weight's share of OPAQUE
uniform vec2 uDepthRange;  // the near and far of glDepthRange, which gl_FragDepth is not mapped by
uniform vec3 uBoxMin;      // the part of the cube that is drawn: all of it, bar a tile's apron
uniform vec3 uBoxMax;
uniform sampler2D uColumn; // the strongest echo in each column, for tinted; see columnMax
uniform vec4 uWorld;       // the cube's corner and size on the ground, in km of one frame for every tile
uniform vec4 uGlow;        // a light inside the clouds: where, in that frame and km up, and how bright; see setGlow

out vec4 fragColour;

vec3 unproject(vec2 ndc, float z) {
  vec4 p = uInverse * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

/**
 * Where a ray enters and leaves the drawn part of the unit cube.
 *
 * The drawn part, not the cube: a tile's texture runs a voxel into each
 * neighbour so the field interpolates across the seam, and that voxel is the
 * neighbour's to draw. Marching it here too would draw the seam twice.
 */
bool hitBox(vec3 origin, vec3 direction, out float near, out float far) {
  vec3 inverse = 1.0 / direction;
  vec3 a = (uBoxMin - origin) * inverse;
  vec3 b = (uBoxMax - origin) * inverse;
  vec3 low = min(a, b), high = max(a, b);
  near = max(max(low.x, low.y), low.z);
  far = min(min(high.x, high.y), high.z);
  return far > max(near, 0.0);
}

vec2 sampleField(vec3 p) {
  vec2 raw = texture(uVolume, p).rg;
  return vec2(raw.r * 255.0 / uDbzScale + uDbzFloor, raw.g);
}

/**
 * The gradient, corrected for the box not being a cube in the world.
 *
 * A step of 1/160 along x is 250 m and the same step along z is 500 m, so a
 * gradient taken in cube units lights the storm as though it were twice as
 * tall as it is.
 */
vec3 fieldNormal(vec3 p, float step) {
  vec3 d = vec3(step, 0.0, 0.0);
  float dx = dot(sampleField(p + d.xyz) - sampleField(p - d.xyz), vec2(0.02, 1.0)) / uExtentKm.x;
  float dy = dot(sampleField(p + d.zxy) - sampleField(p - d.zxy), vec2(0.02, 1.0)) / uExtentKm.y;
  float dz = dot(sampleField(p + d.yzx) - sampleField(p - d.yzx), vec2(0.02, 1.0)) / uExtentKm.z;
  vec3 g = vec3(dx, dy, dz);
  return length(g) > 1e-6 ? normalize(-g) : vec3(0.0, 0.0, 1.0);
}

vec3 paint(float dbz) {
  return texture(uRamp, vec2(clamp((dbz + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;
}

/** The depth of a point in the cube, in the range MapLibre is drawing with. */
float depthOf(vec3 p) {
  vec4 clip = uForward * vec4(p, 1.0);
  return mix(uDepthRange.x, uDepthRange.y, clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0));
}

/**
 * How much of the storm a sample is, 0 to 1.
 *
 * The cloud is nearly solid a little above its floor, which is what gives it
 * an outside. The light rises slowly over the whole of its range instead, so
 * the weak echo around a core tints it and does not hide it.
 */
float densityOf(vec2 field) {
  if (uStyle == 1) {
    float t = clamp((field.x - uLow) / (uHigh - uLow), 0.0, 1.0);
    return t * t * t * field.y;
  }
  return smoothstep(uLow, uHigh, field.x) * field.y;
}

vec4 accumulated = vec4(0.0);
bool wrote = false;
// How far along its ray the sample being lit is, km: for a sky that fades with distance.
float rayKm = 0.0;

/**
 * A surface's opacity, for a cloud at uWeight: the share of it that lets
 * two copies, one over the other at weights adding to one, stop what the
 * surface alone does. Left as it is at a weight of one.
 */
float weighed(float alpha) {
  return uWeight >= 1.0 ? alpha : 1.0 - pow(1.0 - min(alpha, 0.999), uWeight);
}

void lay(vec3 colour, float alpha) {
  accumulated.rgb += (1.0 - accumulated.a) * colour * alpha;
  accumulated.a += (1.0 - accumulated.a) * alpha;
}

/** The cloud and the light: the field as a medium, denser where the echo is stronger. */
void marchMedium(vec3 origin, vec3 direction, float near, float far, bool cutFace, float dither) {
  // Steps in proportion to the length of the ray inside the box: uSteps for
  // one whole width of it, fewer for a ray that only clips an edge or a
  // corner, and never more than uSteps. Every step then covers about the
  // same distance, so a storm boxed by many tiles costs what its own length
  // of ray does, not a full march per tile it brushes.
  float count = clamp(ceil((far - near) * uSteps), 4.0, uSteps);
  float dt = (far - near) / count;
  vec3 light = normalize(vec3(-0.45, -0.7, 0.75));
  // Opacity per kilometre of storm, not per step. A step in the unit cube
  // is a different distance along every direction (the box is 40 by 40
  // by 16 km), so the step has to be measured in the world before it can
  // mean anything, and measured this way the storm is exactly as opaque
  // here as in the panel.
  float stepKm = dt * length(direction * uExtentKm);

  for (float i = 0.0; i < uSteps; i += 1.0) {
    if (i >= count) break;
    vec3 p = origin + direction * (near + dt * (i + dither));
    vec2 field = sampleField(p);
    float density = densityOf(field);
    if (density <= 0.002) continue;

    if (!wrote) {
      // The first sample that is actually storm is what this pixel's depth is,
      // so the map's own geometry occludes it in the right order.
      gl_FragDepth = depthOf(p);
      wrote = true;
    }

    vec3 colour = paint(field.x);
    float alpha;
    if (cutFace && i < 1.0) {
      vec2 behind = sampleField(p + direction * dt * 0.5);
      // The face is the echo itself, whatever the style thins it to: a
      // slice through light would be as faint as the light.
      float here = smoothstep(uLow, min(uHigh, uLow + ${DBZ_HIGH - DBZ_LOW}.0), field.x) * field.y;
      float there = smoothstep(uLow, min(uHigh, uLow + ${DBZ_HIGH - DBZ_LOW}.0), behind.x) * behind.y;
      // A face of two copies of one cloud, one over the other, is one face.
      alpha = weighed(clamp((here + there) * 1.05, 0.0, 1.0));
      colour *= 1.12;
    } else if (uStyle == 1) {
      // Unlit: each reflectivity in its own colour, as on the radar beneath,
      // and giving off more light than it stops, the more the stronger it is.
      alpha = clamp(density * uWeight * stepKm * ${GLOW_OPACITY_PER_KM}, 0.0, 1.0);
      float strength = clamp((field.x - uLow) / (uHigh - uLow), 0.0, 1.0);
      colour *= mix(${GLOW_LIGHT[0]}, ${GLOW_LIGHT[1]}, strength * strength);
    } else {
      float lambert = 0.42 + 0.58 * max(dot(fieldNormal(p, dt), light), 0.0);
      alpha = clamp(density * uWeight * stepKm * ${OPACITY_PER_KM}, 0.0, 1.0);
      colour *= lambert;
    }
    lay(colour, alpha);
    if (accumulated.a > uOpaque) break;
  }
}

/**
 * Reflectivity as the shells see it: the echo, less where the radars saw it
 * poorly, so a surface closes where coverage runs out instead of standing
 * on interpolation.
 */
float seen(vec3 p) {
  vec2 field = sampleField(p);
  return field.x - (1.0 - field.y) * 20.0;
}

/** The shell a reflectivity is inside: its level in dBZ, or far below any for none. */
float shellOf(float dbz) {
  if (dbz < uLow) return -1000.0;
  return max(uLow, min(floor(dbz / ${SHELL_STEP}.0) * ${SHELL_STEP}.0, ${SHELL_TOP}.0));
}

float shellAlpha(float level) {
  return clamp(mix(${SHELL_ALPHA_MIN}, 1.0, (level - ${STYLE_FIELD.shells.floor}.0) / ${SHELL_SOLID_DBZ - STYLE_FIELD.shells.floor}.0), ${SHELL_ALPHA_MIN}, 1.0);
}

vec3 shellNormal(vec3 p, float step) {
  vec3 d = vec3(step, 0.0, 0.0);
  vec3 g = vec3(
    (seen(p + d.xyz) - seen(p - d.xyz)) / uExtentKm.x,
    (seen(p + d.zxy) - seen(p - d.zxy)) / uExtentKm.y,
    (seen(p + d.yzx) - seen(p - d.yzx)) / uExtentKm.z);
  return length(g) > 1e-6 ? normalize(-g) : vec3(0.0, 0.0, 1.0);
}

/** The next shell in from this one, or the outermost from outside them all. */
float shellInside(float level) {
  return level < -500.0 ? uLow : (floor(level / ${SHELL_STEP}.0 + 1e-4) + 1.0) * ${SHELL_STEP}.0;
}

/** The next shell out from this one; far below any from the outermost. */
float shellOutside(float level) {
  if (level <= uLow + 1e-3) return -1000.0;
  return max(uLow, (ceil(level / ${SHELL_STEP}.0 - 1e-4) - 1.0) * ${SHELL_STEP}.0);
}

/** One shell's surface where the ray meets it, from outside it or from within. */
void layShell(float level, vec3 p, vec3 light, vec3 toEye, float step, bool within) {
  if (!wrote) {
    gl_FragDepth = depthOf(p);
    wrote = true;
  }
  vec3 normal = shellNormal(p, step);
  // Lit from the side as the cloud is, and a little from the eye, so a
  // face turned from the light still has a shape. From within, a shell is
  // its own shade: the inside of a bowl, and solid, or an opened storm is
  // a view of whatever stands behind it.
  float lit = 0.34 + 0.5 * max(dot(within ? -normal : normal, light), 0.0) + 0.16 * abs(dot(normal, toEye));
  lay(paint(level) * (within ? 0.72 * lit : lit), weighed(within ? max(shellAlpha(level), 0.92) : shellAlpha(level)));
}

/**
 * The shells: a surface wherever the ray goes from under a level to over it.
 *
 * Found between two samples and put where the field, taken as a straight
 * line between them, crosses the level, so a surface is smooth at a step
 * that would otherwise terrace it.
 *
 * A storm left whole shows each shell from outside only: the back of one is
 * behind its front, and a ray that enters this box already inside one
 * (through the side of a neighbouring tile of the same storm) draws nothing
 * until it reaches the next. A storm cut open is hollow: the cut is not
 * capped, so the shells stand in it one inside another, and a ray leaving a
 * shell from within draws its inner side. Every tile the cut reaches does,
 * whichever side a ray came in by, so the shells of one storm agree across
 * its tiles.
 */
void marchShells(vec3 origin, vec3 direction, float near, float far, float dither) {
  float count = clamp(ceil((far - near) * uSteps), 4.0, uSteps);
  float dt = (far - near) / count;
  vec3 light = normalize(vec3(-0.45, -0.7, 0.75));
  vec3 toEye = -normalize(direction * uExtentKm);
  bool hollow = uPlaneCount > 0;

  float t0 = near;
  float v0 = seen(origin + direction * near);
  float s0 = shellOf(v0);

  // One sample more than there are steps: the last is where the ray leaves,
  // or a surface in the last part of a step is missed along a tile's side.
  for (float i = 0.0; i <= uSteps; i += 1.0) {
    if (i > count) break;
    float t1 = i < count ? near + dt * (i + dither) : far;
    float v1 = seen(origin + direction * t1);
    float s1 = shellOf(v1);
    // Every level crossed in this step, nearest first: inwards, then outwards.
    for (int crossed = 0; crossed < ${SHELL_TOP / SHELL_STEP + 1}; crossed += 1) {
      float level = shellInside(s0);
      if (level > s1 + 1e-3) break;
      vec3 p = origin + direction * mix(t0, t1, clamp((level - v0) / max(v1 - v0, 1e-4), 0.0, 1.0));
      layShell(level, p, light, toEye, dt, false);
      s0 = level;
      if (accumulated.a > uOpaque) return;
    }
    for (int crossed = 0; crossed < ${SHELL_TOP / SHELL_STEP + 1}; crossed += 1) {
      if (s0 <= s1 + 1e-3) break;
      if (hollow) {
        vec3 p = origin + direction * mix(t0, t1, clamp((v0 - s0) / max(v0 - v1, 1e-4), 0.0, 1.0));
        layShell(s0, p, light, toEye, dt, true);
        if (accumulated.a > uOpaque) return;
      }
      s0 = shellOutside(s0);
    }
    t0 = t1;
    v0 = v1;
    s0 = s1;
  }
}

/*
 * The sky and its tint: the storm as a white cloud in sunlight.
 *
 * Lit by a sun that casts shadows rather than by the field's gradient: a
 * real cloud is white because light scatters through it, and grey where the
 * rest of the cloud stands between it and the sun, which a gradient cannot
 * say. So each sample looks towards the sun through a few more of the field,
 * and up through two, for the open sky over it.
 *
 * Everything that differs between tiles is measured in the world, never in
 * a tile's own cube, so the tiles of one storm agree at their seams: the sun
 * is one direction in kilometres, the detail that breaks up the cloud's edge
 * is a noise laid over the ground in one frame for all of them (uWorld), and
 * the column's echo comes from the tile's own texture, which runs a voxel
 * into each neighbour as the volume does. What a tile cannot know is its
 * neighbour's cloud beyond that voxel: a shadow sample past the tile's side
 * reads the edge of its own texture, held, which is close to the
 * neighbour's for the kilometre or two a shadow reaches.
 */

/** Where the sun is, in kilometres: from the west, a little south of it, about 33 degrees up. */
const vec3 SUN = vec3(-0.8, -0.25, 0.55);
const vec3 SUNLIGHT = vec3(1.0, 0.97, 0.92);
const vec3 SKYLIGHT = vec3(0.58, 0.65, 0.76);

float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

/** Smooth value noise, 0 to 1, a cell a unit across. */
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

/** A point of the cube in kilometres of the world, the same frame in every tile. */
vec3 worldKm(vec3 p) {
  return vec3(uWorld.xy + p.xy * uWorld.zw, p.z * uExtentKm.z);
}

${sky}
/** The strongest echo in the column over this point of the ground, in dBZ. */
float columnMax(vec3 p) {
  return texture(uColumn, p.xy).r * 255.0 / uDbzScale + uDbzFloor;
}

/**
 * The white cloud, and with uStyle 4 its hull tinted by the column under it.
 *
 * What it costs: per sample that is cloud, the six lookups of its light
 * (what the cloud spends on its gradient), one of a 2D texture for the
 * tint, and two octaves of noise, arithmetic only, where the edge is. And
 * it stops sooner: nearly opaque, a ray is done a few hundred metres into
 * the cloud, where the cloud's runs on through kilometres of it.
 */
void marchSky(vec3 origin, vec3 direction, float near, float far, bool cutFace, float dither) {
  float count = clamp(ceil((far - near) * uSteps), 4.0, uSteps);
  float dt = (far - near) / count;
  float stepKm = dt * length(direction * uExtentKm);
  float towardSun = dot(normalize(direction * uExtentKm), normalize(SUN));
  bool tinted = uStyle == 4;

  for (float i = 0.0; i < uSteps; i += 1.0) {
    if (i >= count) break;
    vec3 p = origin + direction * (near + dt * (i + dither));
    vec2 field = sampleField(p);
    if (cutFace && i < 1.0) {
      // The face of a cut is the radar's, as in every style: it is what a cut is for.
      vec2 behind = sampleField(p + direction * dt * 0.5);
      float here = smoothstep(uLow, uHigh, field.x) * field.y;
      float there = smoothstep(uLow, uHigh, behind.x) * behind.y;
      float alpha = weighed(clamp((here + there) * 1.05, 0.0, 1.0));
      if (alpha <= 0.002) continue;
      if (!wrote) {
        gl_FragDepth = depthOf(p);
        wrote = true;
      }
      lay(paint(field.x) * 1.12, alpha);
      continue;
    }
    rayKm = (near + dt * (i + dither)) * stepKm / dt;
    float density = skyDensity(p, field);
    if (density <= 0.002) continue;
    if (!wrote) {
      gl_FragDepth = depthOf(p);
      wrote = true;
    }
    vec3 colour = skyLight(p, p.z * uExtentKm.z, towardSun);
    if (tinted) {
      // One more lookup a step, of a small 2D texture; see hullTint.
      float dbz = columnMax(p);
      float t = clamp((dbz - ${HULL_TINT.from}.0) / ${HULL_TINT.full - HULL_TINT.from}.0, 0.0, 1.0);
      colour *= mix(vec3(1.0), paint(dbz), ${HULL_TINT.strength} * t * t * (3.0 - 2.0 * t));
    }
    // Exposed as film is: a sunlit top just short of white, a shadow grey.
    colour = 1.0 - exp(-2.4 * colour);
    // Weighted here only: its shadows (skyLight) are the whole cloud's.
    lay(colour, 1.0 - exp(-density * uWeight * stepKm * ${SKY_OPACITY_PER_KM}));
    if (accumulated.a > uOpaque) break;
  }
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  vec3 origin = unproject(ndc, -1.0);
  vec3 direction = normalize(unproject(ndc, 1.0) - origin);

  float near, far;
  if (!hitBox(origin, direction, near, far)) discard;
  near = max(near, 0.0);

  // The cuts, trimmed off the ray rather than tested per sample, so the exposed
  // face lands exactly on the plane instead of on whichever step came first.
  // One plane for the storm a reader has opened and the clouds around it;
  // Studio's section planes for every cloud, each taking its own side away.
  bool cutFace = false;
  for (int k = 0; k < ${CLIP_PLANES}; k += 1) {
    if (k >= uPlaneCount) break;
    float facing = dot(direction, uPlaneNormal[k]);
    float atPlane = dot(uPlanePoint[k] - origin, uPlaneNormal[k]);
    if (abs(facing) < 1e-6) {
      if (atPlane < 0.0) discard;
    } else {
      float t = atPlane / facing;
      if (facing > 0.0) far = min(far, t);
      else if (t > near) { near = t; cutFace = true; }
    }
  }
  if (far <= near) discard;

  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (uStyle == 2) marchShells(origin, direction, near, far, dither);
  else if (uStyle >= 3) marchSky(origin, direction, near, far, cutFace, dither);
  else marchMedium(origin, direction, near, far, cutFace, dither);

  if (!wrote) discard;
  // Premultiplied: a storm the radars did not see well enough to
  // open is drawn fainter whole, so the map says which storms have a picture.
  fragColour = accumulated * uDim;
}`;

/** How much of its opacity a storm keeps when its coverage is below the floor for opening. */
export const DIM_UNOPENABLE = 0.45;

/* Column-major 4x4 helpers, in the layout WebGL and MapLibre both use.
   Written here rather than pulled from gl-matrix: it is two functions, and
   gl-matrix reaches this project only as one of MapLibre's own dependencies,
   which is not something to start importing from. */
/** Anything indexable by 16 numbers: MapLibre hands over gl-matrix's own type. */
export type Mat4 = ArrayLike<number>;

function multiply(a: Mat4, b: Mat4): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = a[r] * b[c * 4]
        + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function invert(m: Mat4): Float64Array | null {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return new Float64Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}

export function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "volume shader would not compile");
  }
  return shader;
}

/** A column-major 4x4 applied to a point, returning clip-space x, y, z, w. */
export function apply(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

const CORNERS: Array<[number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

/** A box's twelve edges, as pairs of `CORNERS`: those that differ along one axis, which is one bit of the index. */
const BOX_EDGES: Array<[number, number]> = CORNERS.flatMap((_, a) => [1, 2, 4]
  .map((bit) => [a, a | bit] as [number, number])
  .filter(([from, to]) => from !== to));

/** The corners of the drawn part of a box, in its unit cube. */
function cornersOf(box: { min: [number, number, number]; max: [number, number, number] }): Array<[number, number, number]> {
  return CORNERS.map(([x, y, z]) => [
    x ? box.max[0] : box.min[0], y ? box.max[1] : box.min[1], z ? box.max[2] : box.min[2],
  ]);
}

/**
 * The part of the screen a box can cover, in pixels, or null if none of it.
 *
 * Every cloud is a fullscreen triangle whose fragments march only where the
 * ray meets the box. With one cloud that was fine, but a dozen is a dozen
 * fullscreen raymarches a frame. Scissoring each to the rectangle its eight
 * corners project to keeps the cost to the pixels the storm is on, which at the zoom a whole region is looked at is a small fraction of
 * the screen.
 *
 * A corner behind the camera does not project anywhere meaningful, and from
 * a camera among the storms (Studio's flight) every nearby box has one. So
 * the box is cut at the near plane first: of its twelve edges, those that
 * cross it are cut where they do, and the rectangle is that of the corners
 * in front together with the cuts. A box wholly behind covers nothing; a
 * camera inside one has the cut all round the middle of the screen, and the
 * rectangle comes out as the whole viewport, as it should.
 */
export function screenRect(
  forward: Mat4, corners: ReadonlyArray<[number, number, number]>, width: number, height: number,
): [number, number, number, number] | null {
  const clip = corners.map(([x, y, z]) => apply(forward, x, y, z));
  // How far in front of the near plane (z = -w in clip space) each corner is.
  const front = clip.map(([, , z, w]) => z + w);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (cx: number, cy: number, cw: number) => {
    // On the near plane itself w is tiny but positive for any real projection.
    const w = Math.max(cw, 1e-9);
    const px = (cx / w * 0.5 + 0.5) * width;
    const py = (cy / w * 0.5 + 0.5) * height;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  };
  for (let i = 0; i < clip.length; i += 1) {
    if (front[i] >= 0) add(clip[i][0], clip[i][1], clip[i][3]);
  }
  if (!front.some((distance) => distance >= 0)) return null;
  for (const [a, b] of BOX_EDGES) {
    if ((front[a] >= 0) === (front[b] >= 0)) continue;
    const t = front[a] / (front[a] - front[b]);
    const [ax, ay, , aw] = clip[a];
    const [bx, by, , bw] = clip[b];
    add(ax + (bx - ax) * t, ay + (by - ay) * t, aw + (bw - aw) * t);
  }
  if (x0 === Infinity) return null;
  const left = Math.max(0, Math.floor(Math.max(x0, -1e7)) - 2), bottom = Math.max(0, Math.floor(Math.max(y0, -1e7)) - 2);
  const right = Math.min(width, Math.ceil(Math.min(x1, 1e7)) + 2), top = Math.min(height, Math.ceil(Math.min(y1, 1e7)) + 2);
  return right > left && top > bottom ? [left, bottom, right - left, top - bottom] : null;
}

/**
 * The reflectivity that only a storm's strongest `PEEL_CORE_VOXELS` reach.
 *
 * Counted down a histogram of the stored bytes rather than sorted: a volume
 * is a few million voxels and this runs once per storm. Voxels the radars saw
 * poorly are left out, or a smear of interpolated echo at the edge of
 * coverage can be what the peel stops at. Never below the unpeeled floor, so
 * a weak storm simply does not peel.
 */
function coreDbz(cutaway: Cutaway): number {
  const { voxels, header } = cutaway;
  const counts = new Uint32Array(256);
  for (let i = 0; i < voxels.length; i += 2) {
    if (voxels[i + 1] >= 128) counts[voxels[i]] += 1;
  }
  let remaining = PEEL_CORE_VOXELS;
  let byte = 255;
  for (; byte > 0; byte -= 1) {
    remaining -= counts[byte];
    if (remaining <= 0) break;
  }
  return Math.max(DBZ_LOW, byte / header.dbz_scale + header.dbz_floor - PEEL_BAND);
}

/**
 * The strongest echo aloft in each column of a storm's box, from
 * `HULL_TINT.aloftKm` up, as the stored byte: what `tinted` colours its hull
 * by, x across and y down a texture as big as the box's floor.
 *
 * Worked out from the volume itself rather than fetched as a product of its
 * own: nothing more to load, and it stands exactly under the cloud it
 * colours, apron and all, so neighbouring tiles agree at their seam as their
 * volumes do. An echo the radars saw poorly counts for 20 dBZ less, as the
 * shells take it, or a smear of interpolation at the edge of coverage tints
 * a hull as a core would. Then softened over the eight neighbours of each
 * column, a voxel's width each way: a column maximum is speckled at the
 * scale of a voxel, which on a hull reads as grain, not as a storm. At a
 * tile's side the softening has only its own apron to go on, so there the
 * two tiles can differ by a fraction of a voxel's echo.
 */
export function columnMax(cutaway: Pick<Cutaway, "header" | "voxels">): Uint8Array {
  const { voxels, header } = cutaway;
  const { nx, ny, nz } = header;
  const plane = nx * ny;
  const unseen = 20 * header.dbz_scale;
  const peak = new Float32Array(plane);
  // The first layer whose middle is aloft.
  const lowest = Math.max(0, Math.ceil((HULL_TINT.aloftKm * 1000) / header.step_m[2] - 0.5));
  for (let z = lowest, at = lowest * plane * 2; z < nz; z += 1) {
    for (let i = 0; i < plane; i += 1, at += 2) {
      const value = voxels[at] - (1 - voxels[at + 1] / 255) * unseen;
      if (value > peak[i]) peak[i] = value;
    }
  }
  const soft = new Uint8Array(plane);
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const row = Math.min(Math.max(y + dy, 0), ny - 1) * nx;
        for (let dx = -1; dx <= 1; dx += 1) {
          sum += peak[row + Math.min(Math.max(x + dx, 0), nx - 1)] * (2 - Math.abs(dx)) * (2 - Math.abs(dy));
        }
      }
      soft[y * nx + x] = Math.round(sum / 16);
    }
  }
  return soft;
}

/**
 * How much of a storm would read as cloud: the area of its silhouette that is
 * at least half opaque, in km2, seen at the tilt the 3D map opens at, from
 * the south or from the west, whichever shows more of it.
 *
 * The list's peak is the composite's, not the box's, and the two can disagree
 * completely: a box filled from sweeps an hour newer than the composite that
 * seeded it, or a shower that is all drizzle, holds a few hundred voxels just
 * over `DBZ_LOW`, where the shader's opacity is still zero. Measured the way
 * the shader draws it (the same ramp, the same confidence, the same opacity
 * per kilometre), so what this calls faint is what the map would have drawn
 * faint.
 *
 * At the map's tilt rather than straight from the side: looked at along the
 * ground, the 40 km of box a wide, thin shield lies across adds up to a solid
 * wall that no camera on the map ever sees. Each voxel's opacity is spread
 * over the bin of the view plane it lands in; from the north or the east the
 * same rays run the other way, and opacity summed along a ray does not care
 * which way.
 */
export function solidKm2(cutaway: Cutaway): number {
  const { voxels, header } = cutaway;
  const { nx, ny, nz } = header;
  const [sx, sy, sz] = header.step_m.map((metres) => metres / 1000);
  const tilt = (VIEW_PITCH_DEG * Math.PI) / 180;
  const [cos, sin] = [Math.cos(tilt), Math.sin(tilt)];
  // Square bins as fine as the grid across, which is what a reader sees.
  const bin = Math.min(sx, sy);
  // Opacity for each stored reflectivity byte, per voxel and per bin, with
  // the confidence byte's scale folded in, so a voxel costs one multiply.
  const perVoxel = new Float32Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    const t = Math.min(Math.max((byte / header.dbz_scale + header.dbz_floor - DBZ_LOW) / PEEL_BAND, 0), 1);
    perVoxel[byte] = (t * t * (3 - 2 * t) * OPACITY_PER_KM * sx * sy * sz) / (bin * bin * 255);
  }
  // Optical depth through each bin of the two views: x across and y running
  // up the screen, then y across and x up it.
  const [wideX, wideY] = [Math.ceil((nx * sx) / bin), Math.ceil((ny * sy) / bin)];
  const fromSouth = new Float32Array(wideX * (Math.ceil((ny * sy * cos + nz * sz * sin) / bin) + 1));
  const fromWest = new Float32Array(wideY * (Math.ceil((nx * sx * cos + nz * sz * sin) / bin) + 1));
  let at = 0;
  for (let z = 0; z < nz; z += 1) {
    const up = (z + 0.5) * sz * sin;
    for (let y = 0; y < ny; y += 1) {
      const rowY = Math.floor(((y + 0.5) * sy * cos + up) / bin);
      const acrossY = Math.floor(((y + 0.5) * sy) / bin);
      for (let x = 0; x < nx; x += 1, at += 2) {
        const depth = perVoxel[voxels[at]] * voxels[at + 1];
        if (!depth) continue;
        fromSouth[rowY * wideX + Math.floor(((x + 0.5) * sx) / bin)] += depth;
        fromWest[Math.floor(((x + 0.5) * sx * cos + up) / bin) * wideY + acrossY] += depth;
      }
    }
  }
  // Half opaque is a transmittance of a half, exp(-depth) = 0.5.
  const solid = (depths: Float32Array) => (
    depths.reduce((count, depth) => (depth >= Math.LN2 ? count + 1 : count), 0) * bin * bin
  );
  return Math.max(solid(fromSouth), solid(fromWest));
}

/** Whether a storm would be drawn too faint to make out; see `solidKm2`. */
export const isFaint = (cutaway: Cutaway): boolean => solidKm2(cutaway) < SOLID_KM2_MIN;

/**
 * Each storm's peel floor, by the key each of its tiles is held under: the
 * strongest `coreDbz` among the tiles of one storm that peel, so they peel as
 * one cloud (see `Cloud.peelFloor`). A storm from before tiles, with no
 * `system`, is a storm of its own; one that does not peel stays at `DBZ_LOW`.
 */
export function peelFloors(
  clouds: Iterable<[string, { system: string | null; coreDbz: number; peels: boolean }]>,
): Map<string, number> {
  const held = [...clouds];
  const storms = new Map<string, number>();
  const storm = (key: string, system: string | null) => system ?? key;
  for (const [key, { system, coreDbz, peels }] of held) {
    if (peels) storms.set(storm(key, system), Math.max(storms.get(storm(key, system)) ?? DBZ_LOW, coreDbz));
  }
  return new Map(held.map(([key, { system, peels }]) => [key, peels ? storms.get(storm(key, system))! : DBZ_LOW]));
}

/**
 * Where the cut passes through the opened tile, on the map: through the
 * storm, not the middle of the box (see `locateStorm`), as Mercator x and y
 * and a height in the tile's cube scaled to the map.
 */
export function cutPointOf(model: Mat4, cutaway: Pick<Cutaway, "extentM" | "centreKm">): [number, number, number] {
  const { extentM, centreKm } = cutaway;
  const u = 0.5 + centreKm[0] / (extentM[0] / 1000);
  const v = 0.5 + centreKm[1] / (extentM[1] / 1000);
  return [model[12] + model[0] * u, model[13] + model[5] * v, (centreKm[2] / (extentM[2] / 1000)) * model[10]];
}

/**
 * The cut in one cloud's own cube: the opened tile's plane, carried over.
 *
 * Along the heading, so the normal lies across it. The model matrices only
 * scale and translate, so a point maps across by undoing one and doing the
 * other, and the normal by the ratio of the scales: tiles of one storm differ
 * in scale by the cosine of a few kilometres of latitude.
 */
export function carryCut(
  model: Mat4, opened: Mat4, point: readonly [number, number, number], along: number,
): { normal: [number, number, number]; point: [number, number, number] } {
  return {
    normal: [(Math.cos(along) * model[0]) / opened[0], (-Math.sin(along) * model[5]) / opened[5], 0],
    point: [(point[0] - model[12]) / model[0], (point[1] - model[13]) / model[5], point[2] / model[10]],
  };
}

/**
 * How far a cloud's drawn box stands from the cut, on the ground, in km: from
 * the point the cut passes through to the nearest edge of the box, nothing if
 * the point is inside it. `metre` is Mercator units to the metre, at the
 * opened tile.
 */
export function kmFromCut(
  model: Mat4, box: { min: readonly number[]; max: readonly number[] }, point: readonly [number, number, number],
  metre: number,
): number {
  const xs = [model[12] + model[0] * box.min[0], model[12] + model[0] * box.max[0]];
  // Mercator's y runs south, so the cube's y = 1 is the box's smaller y.
  const ys = [model[13] + model[5] * box.min[1], model[13] + model[5] * box.max[1]];
  const dx = Math.max(Math.min(...xs) - point[0], 0, point[0] - Math.max(...xs));
  const dy = Math.max(Math.min(...ys) - point[1], 0, point[1] - Math.max(...ys));
  return Math.hypot(dx, dy) / metre / 1000;
}

/** Whether every corner of a box is on the side of a cut that is gone: then there is nothing of it to draw. */
export function cutAway(
  corners: ReadonlyArray<readonly [number, number, number]>,
  cut: { normal: readonly [number, number, number]; point: readonly [number, number, number] },
): boolean {
  return corners.every((corner) => (
    corner.reduce((sum, value, axis) => sum + cut.normal[axis] * (value - cut.point[axis]), 0) > 0
  ));
}

/** One storm on the map: its field, where its box stands, and its texture once uploaded. */
interface Cloud {
  cutaway: Cutaway;
  model: Float64Array;
  /**
   * The part of its unit cube that is marched, and its corners: the tile,
   * bar its apron, cut down to where it holds any echo the style on the map
   * draws (`echoPart`). `boxes` keeps each floor's once it has been worked
   * out, so going back to a style costs nothing.
   */
  box: BoxPart;
  corners: Array<[number, number, number]>;
  boxes: Map<number, { box: BoxPart; corners: Array<[number, number, number]> }>;
  /** Samples along a ray through it; see `STEPS`. */
  steps: number;
  /** Where its own peel would stop: the reflectivity only its core reaches. */
  coreDbz: number;
  /**
   * Where its peel stops: the strongest `coreDbz` among the tiles of its
   * storm, so one storm's tiles peel as one cloud. Each to its own floor,
   * a weak tile beside a strong one emptied while its neighbour still stood,
   * and the seam between them flickered through every peel.
   */
  peelFloor: number;
  /**
   * The storm it is a tile of, by the code of the tile holding the storm's
   * peak; null where the list does not say, which `stormsOf` then works out.
   */
  system: string | null;
  /** Where its echo reaches its sides, for `stormsOf`; null before tiles. */
  edges: TileEdges | null;
  /** How much of its opacity it keeps; see `DIM_UNOPENABLE`. */
  dim: number;
  /** Whether it peels when not cut; see `setClouds`. */
  peels: boolean;
  /**
   * Which scan it is of while two are drawn: 0 the earlier, 1 the later;
   * null for a cloud that stands on its own scan. See "Between two scans".
   */
  side: 0 | 1 | null;
  /** How far its storm went from its scan to the other, in Mercator units; see lib/cloudMotion.ts. */
  drift: readonly [number, number];
  texture: WebGLTexture | null;
  /** The strongest echo in each of its columns, for `tinted`; made the first time that style draws it. */
  column: WebGLTexture | null;
}

/**
 * What `setClouds` works out of a volume, each a pass over its voxels, kept
 * as long as the volume is: Studio hands the same volumes back scan after
 * scan as a scene plays, and a pass over each of a scan's on the frame its
 * storms come in would hold the frame up.
 */
interface Measured {
  edges: TileEdges | null;
  coreDbz: number | null;
  boxes: Map<number, { box: BoxPart; corners: Array<[number, number, number]> }>;
}
const measured = new WeakMap<Cutaway, Measured>();

/** The drift of a cloud that goes nowhere. */
const STILL: readonly [number, number] = [0, 0];

function measuredOf(cutaway: Cutaway): Measured {
  let known = measured.get(cutaway);
  if (!known) {
    known = { edges: tileEdges(cutaway), coreDbz: null, boxes: new Map() };
    measured.set(cutaway, known);
  }
  return known;
}

/** A storm's own `coreDbz`, worked out once. */
function coreOf(cutaway: Cutaway): number {
  const known = measuredOf(cutaway);
  known.coreDbz ??= coreDbz(cutaway);
  return known.coreDbz;
}

/**
 * How much of its density each scan's clouds keep `fraction` of the way from
 * the earlier to the later, in a style: in proportion, or for the shells,
 * whose copies are surfaces, handed over in the middle third (see "Between
 * two scans").
 */
export function blendWeights(fraction: number, style: CloudStyle): [number, number] {
  const f = Math.min(Math.max(fraction, 0), 1);
  if (style !== "shells") return [1 - f, f];
  const t = Math.min(Math.max((f - 1 / 3) * 3, 0), 1);
  const later = t * t * (3 - 2 * t);
  return [1 - later, later];
}

/**
 * A cloud's model matrix carried `fraction` of the way from its scan to the
 * other along its storm's drift: the earlier scan's forward by that share
 * of it, the later one's back by the rest.
 */
export function carried(model: Float64Array, side: 0 | 1, drift: readonly [number, number], fraction: number): Float64Array {
  const share = side === 0 ? fraction : fraction - 1;
  const out = new Float64Array(model);
  out[12] += drift[0] * share;
  out[13] += drift[1] * share;
  return out;
}

/**
 * What a scenic sky draws besides its clouds' shape, for one context: its
 * sun, and the picture its clouds are drawn in before they are laid over the
 * map. Whoever has such a sky brings this with it (`CloudsLayer.setScenic`,
 * layers/scenicPass.ts): none of it is part of the map.
 */
export interface ScenicPass {
  /** The sun, in the open sky: behind the clouds, which are drawn after it, and the ground. */
  drawSun(main: Mat4): void;
  /**
   * Draw what follows into a picture `scale` of the map's each way, with the
   * map's depths in it: its size, or null where this machine will have none
   * and the clouds go straight onto the map.
   */
  begin(mapWidth: number, mapHeight: number, scale: number): { width: number; height: number } | null;
  /** Lay that picture over the map, which is drawn onto again after. */
  end(mapWidth: number, mapHeight: number): void;
  dispose(): void;
}

export interface CloudsLayer extends CustomLayerInterface {
  /**
   * Replace the set of storms drawn; ones already uploaded are kept, not reloaded.
   *
   * Keyed by the volume's path, not the core's code: a code is a grid
   * position, unique only within one scan, so the same code can name two
   * different storms (or two scans of one) at the same time.
   *
   * `peels: false` holds a storm whole: one the radars did not see well
   * enough to open, whose layers are interpolation, so peeling them shows
   * nothing about where the intensity sits.
   *
   * `side` and `drift` are for two scans drawn at once (`setBlend`): which
   * of the two a cloud is of, and how far its storm went from one to the
   * other, in Mercator units.
   */
  setClouds(clouds: ReadonlyArray<{
    key: string; cutaway: Cutaway; dim?: number; peels?: boolean; system?: string | null;
    side?: 0 | 1 | null; drift?: readonly [number, number];
  }>): void;
  /**
   * How far between its two scans a blend stands, 0 the earlier to 1 the
   * later; null for none, where every cloud is drawn whole where it is. A
   * frame of a blend only moves this: see "Between two scans".
   */
  setBlend(fraction: number | null): void;
  /**
   * Open one storm, by the key it was handed over under, with a cut at this
   * heading. Every cloud near it is cut by the same plane (`CUT_REACH_KM`),
   * so the cut runs across the storm rather than stopping at the tile's
   * edge, and nothing stands whole in front of the face.
   */
  setCut(key: string | null, headingDeg: number): void;
  /**
   * Draw one storm another way than the rest, to look into it: the cloud
   * handed over under `key` and every one near it (`CUT_REACH_KM`, as a cut
   * reaches), in `style` and peeled to `peel`, whatever the map's own are.
   * None for null.
   */
  setInspection(inspection: { key: string; style: CloudStyle; peel: number } | null): void;
  /** Paint the storms in this radar palette, by the name the settings store it under. */
  setColormap(name: string): void;
  /** Draw the storms this way; see lib/cloudStyle.ts. */
  setStyle(style: CloudStyle): void;
  /**
   * Draw the white cloud from another description of its shape and light,
   * GLSL in place of `SKY_PLAIN` with the same three functions, or from the
   * map's own again for null. Studio's flight has one, of clouds to fly
   * among rather than to read a storm from, and brings it with it: it is
   * not part of the map. With it comes what else such a sky draws (`pass`).
   */
  setScenic(sky: string | null, pass?: ((context: WebGL2RenderingContext) => ScenicPass) | null): void;
  /**
   * A light inside the clouds, for a scenic sky to shine with (lightning):
   * where it is, how many kilometres up, and how bright, 0 to 1. None for null.
   */
  setGlow(glow: { lon: number; lat: number; km: number; brightness: number } | null): void;
  /**
   * March the clouds in this share of their usual steps, 1 down to a half
   * or so: coarser, and that much cheaper, for a view that has to keep
   * moving. At 0 they are not drawn at all. And a scenic sky's clouds in a
   * picture this share of the map's each way (`scale`).
   */
  setDetail(share: number, scale?: number): void;
  /**
   * Thin every storm to this peel, 0 whole to 1 down to its core (lib/peel.ts).
   * `own` says the reader set it themself: then it is drawn wherever the
   * camera stands, where a style's default comes in only close up.
   */
  setPeel(peel: number, own: boolean): void;
  /**
   * Cut every cloud by Studio's section planes, in place of the opened
   * storm's own cut; null hands the cutting back to `setCut`. Every cloud,
   * not only those near one: a section plane is the reader's own, placed
   * where they want the map to end.
   */
  setSections(planes: readonly ClipPlane[] | null): void;
}

/**
 * Every storm with a volume, drawn at once: the one a reader opened cut, the rest peeled.
 *
 * One layer rather than one per storm, so they share a program and are drawn
 * in a single pass sorted far to near: they are translucent, and translucent
 * things composite correctly only drawn back to front. Boxes of neighbouring
 * cores can overlap, where the order is only approximately right; the clouds
 * are soft enough there that it does not show.
 */
export function makeCloudsLayer(
  id: string,
  MercatorCoordinate: typeof import("maplibre-gl").MercatorCoordinate,
  initialColormap: string,
  /**
   * Told what a full peel leaves of the strongest storm held, in dBZ, each
   * time the storms change; null with none that peels. What the far end of
   * a peel slider stands for.
   */
  onPeelTop: (dbz: number | null) => void = () => {},
  initialStyle: CloudStyle = "cloud",
): CloudsLayer {
  let gl: WebGL2RenderingContext | null = null;
  let map: GlMap | null = null;
  /** The program drawn with: the map's own, or the scenic one while there is one; see `setScenic`. */
  let program: WebGLProgram | null = null;
  let plainProgram: WebGLProgram | null = null;
  let scenicProgram: WebGLProgram | null = null;
  /**
   * What a scenic sky brings besides its shape, made for this context while
   * the sky is drawn; see `ScenicPass`.
   */
  let scenicPass: ScenicPass | null = null;
  let makeScenicPass: ((context: WebGL2RenderingContext) => ScenicPass) | null = null;
  let scenicScale = 0.5;
  let scenicSky: string | null = null;
  let rampTexture: WebGLTexture | null = null;
  const clouds = new Map<string, Cloud>();
  let cutKey: string | null = null;
  let cutHeading = 0;
  let inspection: { key: string; style: CloudStyle; peel: number } | null = null;
  let glow: [number, number, number, number] = [0, 0, 0, 0];
  let detail = 1;
  let colormap = initialColormap;
  let style = initialStyle;
  /** Uniform locations, looked up once per program rather than a dozen times a frame. */
  let uniforms = new Map<string, WebGLUniformLocation | null>();
  /** How far every storm is thinned, and whether the reader chose it; see `setPeel`. */
  let peel = 0;
  let peelOwn = false;
  /** Studio's section planes, while it is open; see `setSections`. */
  let sections: readonly ClipPlane[] | null = null;
  /** How far between two scans the clouds stand; null drawing one. See `setBlend`. */
  let blend: number | null = null;

  /** The palette as a texture the shader looks reflectivity up in, -32 to +64 dBZ. */
  function paintRamp(context: WebGL2RenderingContext): void {
    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      const [r, g, b] = dbzColour(-32 + (i / 255) * 96, colormap);
      ramp.set([r, g, b, 255], i * 4);
    }
    rampTexture ??= context.createTexture();
    context.bindTexture(context.TEXTURE_2D, rampTexture);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 256, 1, 0, context.RGBA, context.UNSIGNED_BYTE, ramp);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  }

  /**
   * The unit cube, onto the ground the storm is actually over.
   *
   * The scale is negative on y because Mercator's y runs south and the box's
   * does not; the box sits on the ground, so z starts at zero. Upwards it is
   * stretched as the terrain is, by `VERTICAL_SCALE`, in the matrix only:
   * the shader's kilometres stay true, so a storm is as opaque as it is.
   */
  function modelFor(cutaway: Cutaway): Float64Array {
    const { header, extentM } = cutaway;
    const centre = MercatorCoordinate.fromLngLat({ lng: header.lon, lat: header.lat }, 0);
    const metre = centre.meterInMercatorCoordinateUnits();
    const [sx, sy, sz] = [extentM[0] * metre, extentM[1] * metre, extentM[2] * metre * VERTICAL_SCALE];
    return new Float64Array([
      sx, 0, 0, 0,
      0, -sy, 0, 0,
      0, 0, sz, 0,
      centre.x - sx / 2, centre.y + sy / 2, 0, 1,
    ]);
  }

  /**
   * The part of a storm's cube that holds anything a style with this floor
   * draws: marched only where there is echo, not the air above the storm's
   * top, nor the empty part of a tile at the storm's edge.
   */
  function boxFor(cutaway: Cutaway, floor: number, scenic = false): { box: BoxPart; corners: Array<[number, number, number]> } {
    const tile = drawnPart(cutaway.header);
    let echo = echoPart(cutaway, floor - (scenic ? SCENIC_REACH.dbz : 0));
    if (echo && scenic) {
      // A scenic cloud stands out past its echo, sideways and upwards: room for that, or it is cut off flat at the box.
      const pad = [0, 1, 2].map((axis) => (SCENIC_REACH.km[axis] * 1000) / cutaway.extentM[axis]);
      echo = {
        min: [Math.max(echo.min[0] - pad[0], 0), Math.max(echo.min[1] - pad[1], 0), echo.min[2]],
        max: [Math.min(echo.max[0] + pad[0], 1), Math.min(echo.max[1] + pad[1], 1), Math.min(echo.max[2] + pad[2], 1)],
      };
    }
    const box = echo ? overlap(tile, echo) : tile;
    return { box, corners: cornersOf(box) };
  }

  /** A storm's box at the floor of the style on the map, worked out once a floor. */
  function fittedOf(boxes: Cloud["boxes"], cutaway: Cutaway): { box: BoxPart; corners: Array<[number, number, number]> } {
    const { floor } = STYLE_FIELD[style];
    const scenic = scenicSky !== null && (style === "sky" || style === "tinted");
    // A scenic sky's boxes are kept apart from the map's own for the same floor.
    const key = scenic ? floor - 1000 : floor;
    let fitted = boxes.get(key);
    if (!fitted) {
      fitted = boxFor(cutaway, floor, scenic);
      boxes.set(key, fitted);
    }
    return fitted;
  }

  /** Put a storm's box at the floor of the style on the map. */
  function fit(cloud: Cloud): void {
    const fitted = fittedOf(cloud.boxes, cloud.cutaway);
    cloud.box = fitted.box;
    cloud.corners = fitted.corners;
  }

  function upload(context: WebGL2RenderingContext, cutaway: Cutaway): WebGLTexture {
    const { header } = cutaway;
    const texture = context.createTexture()!;
    context.bindTexture(context.TEXTURE_3D, texture);
    context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
    context.texImage3D(context.TEXTURE_3D, 0, context.RG8, header.nx, header.ny, header.nz, 0,
      context.RG, context.UNSIGNED_BYTE, cutaway.voxels);
    for (const axis of [context.TEXTURE_WRAP_S, context.TEXTURE_WRAP_T, context.TEXTURE_WRAP_R]) {
      context.texParameteri(context.TEXTURE_3D, axis, context.CLAMP_TO_EDGE);
    }
    context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    return texture;
  }

  /** A storm's column maximum (`columnMax`) as a texture, for `tinted`. */
  function uploadColumn(context: WebGL2RenderingContext, cutaway: Cutaway): WebGLTexture {
    const texture = context.createTexture()!;
    context.bindTexture(context.TEXTURE_2D, texture);
    context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
    context.texImage2D(context.TEXTURE_2D, 0, context.R8, cutaway.header.nx, cutaway.header.ny, 0,
      context.RED, context.UNSIGNED_BYTE, columnMax(cutaway));
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    return texture;
  }

  /** Let go of a storm's column texture, if it has one. */
  function dropColumn(context: WebGL2RenderingContext | null, cloud: Cloud | undefined): void {
    if (context && cloud?.column) context.deleteTexture(cloud.column);
    if (cloud) cloud.column = null;
  }


  /** The shader with this description of the white cloud in it, linked. */
  function link(context: WebGL2RenderingContext, sky: string): WebGLProgram {
    const linked = context.createProgram()!;
    context.attachShader(linked, compile(context, context.VERTEX_SHADER, VERTEX));
    context.attachShader(linked, compile(context, context.FRAGMENT_SHADER, fragment(sky)));
    context.linkProgram(linked);
    if (!context.getProgramParameter(linked, context.LINK_STATUS)) {
      throw new Error(context.getProgramInfoLog(linked) ?? "volume shader would not link");
    }
    return linked;
  }

  /**
   * Draw with the scenic sky where one has been handed over, else the
   * map's own; a scenic one that will not compile is let go of with a
   * warning, and the storms stay as the map draws them.
   */
  function useSky(context: WebGL2RenderingContext): void {
    if (scenicProgram) context.deleteProgram(scenicProgram);
    scenicProgram = null;
    if (scenicSky !== null) {
      try {
        scenicProgram = link(context, scenicSky);
      } catch (error) {
        console.warn("The scenic sky would not compile", error);
      }
    }
    scenicPass?.dispose();
    scenicPass = null;
    if (scenicProgram && makeScenicPass) {
      try {
        scenicPass = makeScenicPass(context);
      } catch (error) {
        // The clouds are drawn all the same: straight onto the map, and without a sun.
        console.warn("The scenic sky's own passes would not compile", error);
      }
    }
    program = scenicProgram ?? plainProgram;
    uniforms = new Map();
  }

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    setClouds(next) {
      const wanted = new Set(next.map((cloud) => cloud.key));
      for (const [key, cloud] of clouds) {
        if (wanted.has(key)) continue;
        if (gl && cloud.texture) gl.deleteTexture(cloud.texture);
        dropColumn(gl, cloud);
        clouds.delete(key);
      }
      for (const { key, cutaway, dim = 1, peels = true, system = null, side = null, drift = STILL } of next) {
        const kept = clouds.get(key);
        if (kept?.cutaway === cutaway) {
          if (peels && !kept.peels) kept.coreDbz = coreOf(cutaway);
          kept.dim = dim;
          kept.peels = peels;
          kept.system = system;
          kept.side = side;
          kept.drift = drift;
          continue;
        }
        if (kept?.texture && gl) gl.deleteTexture(kept.texture);
        dropColumn(gl, kept);
        // Steps are counted on the tile, so a step is the same length in every box.
        const tile = drawnPart(cutaway.header);
        const across = Math.max(
          cutaway.header.nx * (tile.max[0] - tile.min[0]), cutaway.header.ny * (tile.max[1] - tile.min[1]),
        );
        const known = measuredOf(cutaway);
        const fitted = fittedOf(known.boxes, cutaway);
        // A pass over every voxel, so only for a storm that will use it.
        const own = peels ? coreOf(cutaway) : DBZ_LOW;
        clouds.set(key, {
          cutaway,
          model: modelFor(cutaway),
          ...fitted,
          boxes: known.boxes,
          steps: Math.max(16, Math.round((STEPS * across) / STEPS_VOXELS)),
          coreDbz: own,
          peelFloor: own,
          system,
          edges: known.edges,
          dim,
          peels,
          side,
          drift,
          texture: gl ? upload(gl, cutaway) : null,
          column: null,
        });
      }
      const storms = stormsOf([...clouds].map(([key, { cutaway: { header }, system, edges }]) => [
        key, { network: header.network ?? null, tile: header.tile ?? null, system, edges },
      ]));
      const floors = peelFloors([...clouds].map(([key, cloud]) => [key, { ...cloud, system: storms.get(key)! }]));
      for (const [key, floor] of floors) clouds.get(key)!.peelFloor = floor;
      const peeling = [...clouds.values()].filter((cloud) => cloud.peels);
      onPeelTop(peeling.length ? Math.max(...peeling.map((cloud) => cloud.peelFloor)) : null);
    },

    setCut(key, headingDeg) {
      cutKey = key;
      cutHeading = headingDeg;
    },

    setColormap(name) {
      colormap = name;
      if (gl) paintRamp(gl);
    },

    setPeel(level, own) {
      peel = level;
      peelOwn = own;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setStyle(next) {
      if (next === style) return;
      style = next;
      for (const cloud of clouds.values()) fit(cloud);
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setScenic(sky, pass = null) {
      if (sky === scenicSky) return;
      scenicSky = sky;
      makeScenicPass = sky === null ? null : pass;
      for (const cloud of clouds.values()) fit(cloud);
      if (gl) useSky(gl);
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setGlow(next) {
      if (!next || next.brightness <= 0) {
        if (glow[3] === 0) return;
        glow = [0, 0, 0, 0];
      } else {
        const at = MercatorCoordinate.fromLngLat({ lng: next.lon, lat: next.lat }, 0);
        glow = [at.x * NOISE_KM_PER_MERCATOR, at.y * NOISE_KM_PER_MERCATOR, next.km, next.brightness];
      }
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setDetail(share, scale = 0.5) {
      // Nothing, for a view that cloud round the eye hides altogether.
      const next = share <= 0 ? 0 : Math.min(Math.max(share, 0.4), 1);
      const size = Math.min(Math.max(scale, 0.2), 1);
      if (next === detail && size === scenicScale) return;
      detail = next;
      scenicScale = size;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setInspection(next) {
      if (next?.key === inspection?.key && next?.style === inspection?.style && next?.peel === inspection?.peel) return;
      inspection = next;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setSections(planes) {
      sections = planes ? planes.slice(0, CLIP_PLANES) : null;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    setBlend(fraction) {
      if (fraction === blend) return;
      blend = fraction;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    onAdd(added: GlMap, context: WebGL2RenderingContext) {
      map = added;
      gl = context;
      plainProgram = link(context, SKY_PLAIN);
      useSky(context);

      paintRamp(context);

      // Storms handed over before the layer existed get their textures now.
      for (const cloud of clouds.values()) cloud.texture ??= upload(context, cloud.cutaway);
    },

    render(context: WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!program) return;
      if (scenicProgram && scenicPass && detail > 0) scenicPass.drawSun(options.defaultProjectionData.mainMatrix);
      if (!clouds.size || detail <= 0) return;
      // `mainMatrix`, the one documented to take spherical mercator; see the
      // model matrix above for the space the boxes are built in.
      const main = options.defaultProjectionData.mainMatrix;
      // One peel for every storm, drawn in full where the reader set it and
      // otherwise only close up; see lib/peel.ts. Standing still: nothing
      // here asks for another frame.
      const peelNow = peel * peelShare(map?.getZoom() ?? 0, peelOwn);
      const [mapWidth, mapHeight] = [context.drawingBufferWidth, context.drawingBufferHeight];
      // A scenic sky is drawn aside, smaller, and laid over the map after; see `ScenicPass`.
      const apart = scenicPass && program === scenicProgram && (style === "sky" || style === "tinted")
        ? scenicPass.begin(mapWidth, mapHeight, scenicScale) : null;
      const width = apart ? apart.width : mapWidth;
      const height = apart ? apart.height : mapHeight;

      // Far to near, down the tiles' quadtree from where the camera stands,
      // and by where each box's middle lands in clip space where it cannot
      // say; see lib/drawOrder.ts.
      const unmain = invert(main);
      const camera = unmain ? cameraOf(unmain) : [0.5, 0.5, 0];
      // Between two scans, each cloud carried along its storm and weighted by
      // how near its own scan the moment is; see "Between two scans". One of
      // no weight at all is not drawn.
      const weights = blend === null ? null : blendWeights(blend, style);
      const ordered = farToNear([...clouds.entries()]
        .filter(([, cloud]) => cloud.texture)
        .map(([key, cloud]) => {
          const side = weights === null ? null : cloud.side;
          const weight = side === null ? 1 : weights![side];
          const model = side === null ? cloud.model : carried(cloud.model, side, cloud.drift, blend!);
          const forward = multiply(main, model);
          const [, , z, w] = apply(forward, 0.5, 0.5, 0.25);
          const rect = weight > 1e-3 ? screenRect(forward, cloud.corners, width, height) : null;
          return {
            key, cloud, model, weight, forward, rect, depth: w > 0 ? z / w : Infinity, tile: cloud.cutaway.header.tile ?? null,
          };
        }), camera);

      context.useProgram(program);
      const at = (name: string) => {
        let location = uniforms.get(name);
        if (location === undefined) {
          location = context.getUniformLocation(program!, name);
          uniforms.set(name, location);
        }
        return location;
      };
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, rampTexture);
      context.uniform1i(at("uRamp"), 1);
      context.uniform1i(at("uVolume"), 0);
      // A unit of its own whether or not the style reads it: two samplers of
      // different kinds on one unit fail the draw.
      context.uniform1i(at("uColumn"), 2);
      context.uniform2f(at("uViewport"), width, height);
      // Whatever MapLibre has set for this layer; see "Depth" above.
      const [depthNear, depthFar] = context.getParameter(context.DEPTH_RANGE) as Float32Array;
      context.uniform2f(at("uDepthRange"), depthNear, depthFar);
      context.uniform1i(at("uStyle"), STYLE_INDEX[style]);
      context.uniform4f(at("uGlow"), glow[0], glow[1], glow[2], glow[3]);
      const field = STYLE_FIELD[style];

      context.enable(context.BLEND);
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LESS);
      // Tested but not written: translucent storms that wrote depth would erase
      // whatever is drawn behind them, including each other.
      context.depthMask(false);
      context.disable(context.CULL_FACE);

      // The cut, on the map, carried into each cut tile's cube; see `carryCut`.
      const opened = cutKey !== null && sections === null ? clouds.get(cutKey) : undefined;
      const along = (cutHeading * Math.PI) / 180;
      const cutPoint = opened ? cutPointOf(opened.model, opened.cutaway) : null;
      const metre = opened ? opened.model[0] / opened.cutaway.extentM[0] : 0;
      // The storm looked into, and where it stands: the clouds round it are drawn as it is.
      const inspected = inspection ? clouds.get(inspection.key) : undefined;
      const inspectPoint = inspected ? cutPointOf(inspected.model, inspected.cutaway) : null;
      const inspectMetre = inspected ? inspected.model[0] / inspected.cutaway.extentM[0] : 0;

      for (const { key, cloud, model, weight, forward, rect } of ordered) {
        if (rect === null) continue;
        const inverse = invert(forward);
        if (!inverse) continue;
        const { header, extentM } = cloud.cutaway;

        // The opened tile, and every cloud near enough to stand in front of
        // its face; see `CUT_REACH_KM`. One wholly on the side that is gone
        // is not drawn at all.
        const plane = opened !== undefined && cutPoint !== null
          && (key === cutKey || kmFromCut(model, cloud.box, cutPoint, metre) <= CUT_REACH_KM)
          ? carryCut(model, opened.model, cutPoint, along)
          : null;
        // Studio's planes in this cloud's cube, or the opened storm's one:
        // where it stands now, so a storm moves through a plane that stays.
        const cuts = sections
          ? sections.map((section) => carryPlane(model, extentM, section))
          : plane ? [plane] : [];
        if (cuts.some((cut) => cutAway(cloud.corners, cut))) continue;

        context.enable(context.SCISSOR_TEST);
        context.scissor(rect[0], rect[1], rect[2], rect[3]);

        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_3D, cloud.texture);
        context.uniformMatrix4fv(at("uForward"), false, new Float32Array(forward));
        context.uniformMatrix4fv(at("uInverse"), false, new Float32Array(inverse));
        context.uniform3f(at("uExtentKm"), extentM[0] / 1000, extentM[1] / 1000, extentM[2] / 1000);
        context.uniform3f(at("uBoxMin"), ...cloud.box.min);
        context.uniform3f(at("uBoxMax"), ...cloud.box.max);
        // A scenic sky's cloud is soft at every scale: three steps in four do for it.
        context.uniform1f(at("uSteps"), Math.max(8, Math.round(cloud.steps * detail * (apart ? 0.75 : 1))));
        context.uniform1f(at("uDbzFloor"), header.dbz_floor);
        context.uniform1f(at("uDbzScale"), header.dbz_scale);
        const looked = inspection !== null && inspectPoint !== null
          && (key === inspection.key || kmFromCut(model, cloud.box, inspectPoint, inspectMetre) <= CUT_REACH_KM);
        const drawnAs = looked ? inspection!.style : style;
        const drawnField = looked ? STYLE_FIELD[drawnAs] : field;
        context.uniform1i(at("uStyle"), STYLE_INDEX[drawnAs]);
        if (drawnAs === "sky" || drawnAs === "tinted") {
          // Where the cloud stands now: the billows stay put in the world
          // while a storm moves through them, so its two copies between two
          // scans share theirs, and nothing jumps when the next pair comes up.
          context.uniform4f(at("uWorld"), model[12] * NOISE_KM_PER_MERCATOR, model[13] * NOISE_KM_PER_MERCATOR,
            model[0] * NOISE_KM_PER_MERCATOR, model[5] * NOISE_KM_PER_MERCATOR);
        }
        if (drawnAs === "tinted") {
          context.activeTexture(context.TEXTURE2);
          cloud.column ??= uploadColumn(context, cloud.cutaway);
          context.bindTexture(context.TEXTURE_2D, cloud.column);
        }

        // Not the storm a reader opened, nor the clouds its cut reaches: a
        // cut shows the envelope the peel would take away.
        const peelsNow = !plane && cloud.peels;
        context.uniform1i(at("uPlaneCount"), cuts.length);
        context.uniform1f(at("uDim"), cloud.dim);
        context.uniform1f(at("uWeight"), weight);
        // Two copies whose transmittances multiply to what one stops at.
        context.uniform1f(at("uOpaque"), 1 - (1 - OPAQUE) ** weight);
        // From the style's floor to the storm's core. The top of the ramp
        // stays where the style has it until the peel has thinned the storm
        // to within a cloud's band of it, so a core is never fainter peeled.
        const low = looked
          ? peelLow(drawnField.floor, cloud.peelFloor, inspection!.peel)
          : peelsNow ? peelLow(field.floor, cloud.peelFloor, peelNow) : field.floor;
        context.uniform1f(at("uLow"), low);
        context.uniform1f(at("uHigh"), Math.max(drawnField.floor + drawnField.band, low + PEEL_BAND));
        if (cuts.length) {
          context.uniform3fv(at("uPlaneNormal"), cuts.flatMap((cut) => cut.normal));
          context.uniform3fv(at("uPlanePoint"), cuts.flatMap((cut) => cut.point));
        }
        context.drawArrays(context.TRIANGLES, 0, 3);
      }

      context.disable(context.SCISSOR_TEST);
      if (apart) scenicPass?.end(mapWidth, mapHeight);
      context.depthMask(true);
    },

    onRemove(removed: GlMap, context: WebGL2RenderingContext) {
      for (const cloud of clouds.values()) {
        if (cloud.texture) context.deleteTexture(cloud.texture);
        cloud.texture = null;
        dropColumn(context, cloud);
      }
      if (rampTexture) context.deleteTexture(rampTexture);
      if (plainProgram) context.deleteProgram(plainProgram);
      scenicPass?.dispose();
      scenicPass = null;
      if (scenicProgram) context.deleteProgram(scenicProgram);
      program = null;
      plainProgram = null;
      scenicProgram = null;
      rampTexture = null;
      gl = null;
      map = null;
    },
  };
}
