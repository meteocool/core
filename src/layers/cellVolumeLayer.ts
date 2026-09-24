/**
 * Every storm's volume, drawn into the 3D map, with the one a reader opened cut.
 *
 * `CellCutaway` renders one volume in a panel with a camera of its own, which
 * is the right place to study a storm and the wrong place to see where it is.
 * This puts them all on the map at once: the same field and the same shader,
 * standing on the ground each storm is over, at the scale of the terrain, as
 * a sky of clouds -- whole, except the one being inspected, which is sliced
 * so its core shows.
 *
 * ## How a raymarcher gets onto a MapLibre map
 *
 * MapLibre has no volume primitive and never will. What it has is
 * `CustomLayerInterface`, which hands over the GL context and the
 * `modelViewProjectionMatrix` for the frame and gets out of the way -- and a
 * matrix is all a raymarcher needs, because the march happens in the box's own
 * space and the matrix is only used to work out where each ray enters it.
 *
 * ## Why the box is a unit cube
 *
 * The obvious model matrix leaves the box in Mercator units, where the whole
 * world is 0 to 1 and a 40 km storm is about a thousandth of that. Marching a
 * ray through numbers that small in `highp float` bands visibly. So the model
 * matrix maps the unit cube onto the box instead: the shader marches [0,1] in
 * each axis, the texture lookup is the position itself, and the precision
 * problem never arises.
 *
 * Mercator's y runs south, which is why the scale below is negative on that
 * axis -- without it the storm is mirrored north to south, which looks almost
 * right and is completely wrong.
 *
 * ## Depth
 *
 * The volume is depth-*tested* but does not depth-*write*: terrain and other
 * storms occlude it, and it does not carve holes in whatever is drawn after
 * it. `gl_FragDepth` comes from the point where the ray enters the storm
 * rather than from the fullscreen triangle, or the whole box would sit at one
 * depth and either float in front of everything or vanish behind it.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GlMap } from "maplibre-gl";
import type { Cutaway } from "../lib/cellCutaway";
import { dbzColour } from "../lib/cellVolume";

/** Reflectivity below this is drizzle or the fringe of the anvil. */
const DBZ_LOW = 20;
/** Where the echo is as opaque as it gets; see `CellCutaway` for the reasoning. */
const DBZ_HIGH = 34;
/** Samples along each ray. Fewer than the panel uses: this shares a frame. */
const STEPS = 128;

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform mat4 uInverse;     // clip space back to the unit cube
uniform mat4 uForward;     // and out again, for the depth of the entry point
uniform vec2 uViewport;
uniform vec3 uExtentKm;    // what one unit of the cube is worth, per axis
uniform vec3 uPlaneNormal;
uniform vec3 uPlanePoint;
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uSteps;
uniform float uCut;        // 1 for the storm being inspected, 0 for every other

out vec4 fragColour;

vec3 unproject(vec2 ndc, float z) {
  vec4 p = uInverse * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

/** Where a ray enters and leaves the unit cube. */
bool hitBox(vec3 origin, vec3 direction, out float near, out float far) {
  vec3 inverse = 1.0 / direction;
  vec3 a = (vec3(0.0) - origin) * inverse;
  vec3 b = (vec3(1.0) - origin) * inverse;
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

void main() {
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  vec3 origin = unproject(ndc, -1.0);
  vec3 direction = normalize(unproject(ndc, 1.0) - origin);

  float near, far;
  if (!hitBox(origin, direction, near, far)) discard;
  near = max(near, 0.0);

  // The cut, trimmed off the ray rather than tested per sample, so the exposed
  // face lands exactly on the plane instead of on whichever step came first.
  // Only the storm a reader has opened is cut; every other one is drawn whole,
  // because a sky of clouds all sliced the same way reads as a rendering fault.
  bool cutFace = false;
  if (uCut > 0.5) {
    float facing = dot(direction, uPlaneNormal);
    float atPlane = dot(uPlanePoint - origin, uPlaneNormal);
    if (abs(facing) < 1e-6) {
      if (atPlane < 0.0) discard;
    } else {
      float t = atPlane / facing;
      if (facing > 0.0) far = min(far, t);
      else if (t > near) { near = t; cutFace = true; }
    }
    if (far <= near) discard;
  }

  float dt = (far - near) / uSteps;
  vec3 light = normalize(vec3(-0.45, -0.7, 0.75));
  vec4 accumulated = vec4(0.0);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  bool wrote = false;

  for (float i = 0.0; i < uSteps; i += 1.0) {
    vec3 p = origin + direction * (near + dt * (i + dither));
    vec2 field = sampleField(p);
    float density = smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, field.x) * field.y;
    if (density <= 0.002) continue;

    if (!wrote) {
      // The first sample that is actually storm is what this pixel's depth is,
      // so the map's own geometry occludes it in the right order.
      vec4 clip = uForward * vec4(p, 1.0);
      gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
      wrote = true;
    }

    vec3 colour = texture(uRamp, vec2(clamp((field.x + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;
    float alpha;
    if (cutFace && i < 1.0) {
      vec2 behind = sampleField(p + direction * dt * 0.5);
      float smoothed = 0.5 * (density + smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, behind.x) * behind.y);
      alpha = clamp(smoothed * 2.1, 0.0, 1.0);
      colour *= 1.12;
    } else {
      float lambert = 0.42 + 0.58 * max(dot(fieldNormal(p, dt), light), 0.0);
      // Opacity per kilometre of storm, not per step. A step in the unit cube
      // is a different distance along every direction -- the box is 40 by 40
      // by 16 km -- so the step has to be measured in the world before it can
      // mean anything, and measured this way the storm is exactly as opaque
      // here as in the panel.
      float stepKm = dt * length(direction * uExtentKm);
      alpha = clamp(density * stepKm * 0.62, 0.0, 1.0);
      colour *= lambert;
    }
    accumulated.rgb += (1.0 - accumulated.a) * colour * alpha;
    accumulated.a += (1.0 - accumulated.a) * alpha;
    if (accumulated.a > 0.985) break;
  }

  if (!wrote) discard;
  fragColour = accumulated;
}`;

/* Column-major 4x4 helpers, in the layout WebGL and MapLibre both use.
   Written here rather than pulled from gl-matrix: it is two functions, and
   gl-matrix reaches this project only as one of MapLibre's own dependencies,
   which is not something to start importing from. */
/** Anything indexable by 16 numbers: MapLibre hands over gl-matrix's own type. */
type Mat4 = ArrayLike<number>;

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

function invert(m: Mat4): Float64Array | null {
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

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "volume shader would not compile");
  }
  return shader;
}

/** A column-major 4x4 applied to a point, returning clip-space x, y, z, w. */
function apply(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
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

/**
 * The part of the screen a box can cover, in pixels, or null if none of it.
 *
 * Every cloud is a fullscreen triangle whose fragments march only where the
 * ray meets the box -- and with one cloud that was fine, but a dozen is a
 * dozen fullscreen raymarches a frame. Scissoring each to the rectangle its
 * eight corners project to keeps the cost to the pixels the storm is actually
 * on, which at the zoom a whole region is looked at is a small fraction of
 * the screen. A corner behind the camera makes the projection meaningless,
 * so that case falls back to the whole viewport rather than guessing.
 */
function screenRect(
  forward: Mat4, width: number, height: number,
): [number, number, number, number] | "all" | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, z] of CORNERS) {
    const [cx, cy, , cw] = apply(forward, x, y, z);
    if (cw <= 0) return "all";
    const px = (cx / cw * 0.5 + 0.5) * width;
    const py = (cy / cw * 0.5 + 0.5) * height;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const left = Math.max(0, Math.floor(x0) - 2), bottom = Math.max(0, Math.floor(y0) - 2);
  const right = Math.min(width, Math.ceil(x1) + 2), top = Math.min(height, Math.ceil(y1) + 2);
  return right > left && top > bottom ? [left, bottom, right - left, top - bottom] : null;
}

/** One storm on the map: its field, where its box stands, and its texture once uploaded. */
interface Cloud {
  cutaway: Cutaway;
  model: Float64Array;
  texture: WebGLTexture | null;
}

export interface CloudsLayer extends CustomLayerInterface {
  /** Replace the set of storms drawn; ones already uploaded are kept, not reloaded. */
  setClouds(clouds: ReadonlyArray<{ code: string; cutaway: Cutaway }>): void;
  /** Open one storm with a cut at this heading, or close whichever was open. */
  setCut(code: string | null, headingDeg: number): void;
}

/**
 * Every storm with a volume, drawn at once, with the one a reader opened cut.
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
): CloudsLayer {
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let rampTexture: WebGLTexture | null = null;
  const clouds = new Map<string, Cloud>();
  let cutCode: string | null = null;
  let cutHeading = 0;

  /**
   * The unit cube, onto the ground the storm is actually over.
   *
   * The scale is negative on y because Mercator's y runs south and the box's
   * does not; the box sits on the ground, so z starts at zero.
   */
  function modelFor(cutaway: Cutaway): Float64Array {
    const { header, extentM } = cutaway;
    const centre = MercatorCoordinate.fromLngLat({ lng: header.lon, lat: header.lat }, 0);
    const metre = centre.meterInMercatorCoordinateUnits();
    const [sx, sy, sz] = [extentM[0] * metre, extentM[1] * metre, extentM[2] * metre];
    return new Float64Array([
      sx, 0, 0, 0,
      0, -sy, 0, 0,
      0, 0, sz, 0,
      centre.x - sx / 2, centre.y + sy / 2, 0, 1,
    ]);
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

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    setClouds(next) {
      const wanted = new Set(next.map((cloud) => cloud.code));
      for (const [code, cloud] of clouds) {
        if (wanted.has(code)) continue;
        if (gl && cloud.texture) gl.deleteTexture(cloud.texture);
        clouds.delete(code);
      }
      for (const { code, cutaway } of next) {
        const held = clouds.get(code);
        if (held?.cutaway === cutaway) continue;
        // The same code for a different volume: a core whose peak stayed on
        // one pixel into the next scan. A code is a grid position, unique only
        // within a scan, so keeping whichever arrived first for it drew the
        // storm as it had been at the first scan for as long as it sat still.
        if (held?.texture && gl) gl.deleteTexture(held.texture);
        clouds.set(code, { cutaway, model: modelFor(cutaway), texture: gl ? upload(gl, cutaway) : null });
      }
    },

    setCut(code, headingDeg) {
      cutCode = code;
      cutHeading = headingDeg;
    },

    onAdd(_map: GlMap, context: WebGL2RenderingContext) {
      gl = context;
      program = context.createProgram()!;
      context.attachShader(program, compile(context, context.VERTEX_SHADER, VERTEX));
      context.attachShader(program, compile(context, context.FRAGMENT_SHADER, FRAGMENT));
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) {
        throw new Error(context.getProgramInfoLog(program) ?? "volume shader would not link");
      }

      const ramp = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i += 1) {
        const [r, g, b] = dbzColour(-32 + (i / 255) * 96);
        ramp.set([r, g, b, 255], i * 4);
      }
      rampTexture = context.createTexture();
      context.bindTexture(context.TEXTURE_2D, rampTexture);
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 256, 1, 0, context.RGBA, context.UNSIGNED_BYTE, ramp);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);

      // Storms handed over before the layer existed get their textures now.
      for (const cloud of clouds.values()) cloud.texture ??= upload(context, cloud.cutaway);
    },

    render(context: WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!program || !clouds.size) return;
      // `mainMatrix`, the one documented to take spherical mercator; see the
      // model matrix above for the space the boxes are built in.
      const main = options.defaultProjectionData.mainMatrix;
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;

      // Far to near, by where each box's middle lands in clip space.
      const ordered = [...clouds.entries()]
        .filter(([, cloud]) => cloud.texture)
        .map(([code, cloud]) => {
          const forward = multiply(main, cloud.model);
          const [, , z, w] = apply(forward, 0.5, 0.5, 0.25);
          return { code, cloud, forward, depth: w > 0 ? z / w : Infinity };
        })
        .sort((a, b) => b.depth - a.depth);

      context.useProgram(program);
      const at = (name: string) => context.getUniformLocation(program!, name);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, rampTexture);
      context.uniform1i(at("uRamp"), 1);
      context.uniform1i(at("uVolume"), 0);
      context.uniform2f(at("uViewport"), width, height);
      context.uniform1f(at("uSteps"), STEPS);

      context.enable(context.BLEND);
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LESS);
      // Tested but not written: translucent storms that wrote depth would erase
      // whatever is drawn behind them, including each other.
      context.depthMask(false);
      context.disable(context.CULL_FACE);

      for (const { code, cloud, forward } of ordered) {
        const rect = screenRect(forward, width, height);
        if (rect === null) continue;
        const inverse = invert(forward);
        if (!inverse) continue;
        const { header, extentM, centreKm } = cloud.cutaway;

        if (rect === "all") {
          context.disable(context.SCISSOR_TEST);
        } else {
          context.enable(context.SCISSOR_TEST);
          context.scissor(rect[0], rect[1], rect[2], rect[3]);
        }

        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_3D, cloud.texture);
        context.uniformMatrix4fv(at("uForward"), false, new Float32Array(forward));
        context.uniformMatrix4fv(at("uInverse"), false, new Float32Array(inverse));
        context.uniform3f(at("uExtentKm"), extentM[0] / 1000, extentM[1] / 1000, extentM[2] / 1000);
        context.uniform1f(at("uDbzFloor"), header.dbz_floor);
        context.uniform1f(at("uDbzScale"), header.dbz_scale);

        const cut = code === cutCode;
        context.uniform1f(at("uCut"), cut ? 1 : 0);
        if (cut) {
          // Along the heading, so the normal lies across it; through the storm,
          // not the middle of the box. The two horizontal axes share a scale in
          // cube space, so the heading needs no correction.
          const along = (cutHeading * Math.PI) / 180;
          context.uniform3f(at("uPlaneNormal"), Math.cos(along), -Math.sin(along), 0);
          context.uniform3f(at("uPlanePoint"),
            0.5 + centreKm[0] / (extentM[0] / 1000),
            0.5 + centreKm[1] / (extentM[1] / 1000),
            centreKm[2] / (extentM[2] / 1000));
        }
        context.drawArrays(context.TRIANGLES, 0, 3);
      }

      context.disable(context.SCISSOR_TEST);
      context.depthMask(true);
    },

    onRemove(_map: GlMap, context: WebGL2RenderingContext) {
      for (const cloud of clouds.values()) {
        if (cloud.texture) context.deleteTexture(cloud.texture);
        cloud.texture = null;
      }
      if (rampTexture) context.deleteTexture(rampTexture);
      if (program) context.deleteProgram(program);
      program = null;
      rampTexture = null;
      gl = null;
    },
  };
}
