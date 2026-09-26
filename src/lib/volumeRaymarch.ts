/**
 * The raymarcher behind every picture of a storm's volume in a panel.
 *
 * Moved out of `CellCutaway` when a second picture wanted it: the CAPPI in
 * `CappiSweep` is the same volume, the same transfer function and the same
 * cut -- only the plane lies flat and moves up and down instead of standing
 * and turning. See `CellCutaway` for why this is raymarched rather than
 * meshed, and written against WebGL2 directly.
 *
 * The cut discards everything on the positive side of one plane. A vertical
 * plane through the storm is the cross-section; a horizontal one with its
 * normal pointing up is a CAPPI, everything above the chosen height gone.
 */
import { FRAMING_DBZ } from "./cellCutaway";
import type { Cutaway } from "./cellCutaway";
import { dbzColour } from "./cellVolume";

type Vec3 = [number, number, number];

/** Samples along each ray. Enough that the banding is gone on a postcard. */
const STEPS = 160;

/**
 * Below this the echo is drizzle, clutter or the outermost fringe of the anvil.
 * Shared with the framing, or the camera frames air the shader does not draw.
 */
const DBZ_LOW = FRAMING_DBZ;
/**
 * Where the echo has become as opaque as it gets.
 *
 * Low enough that the envelope is a visible cloud rather than a hint: with the
 * ceiling up at the core's own reflectivity the storm renders as its core
 * floating in clear air, which is both wrong and the one thing this picture is
 * supposed to put in context.
 */
const DBZ_HIGH = 34;

const VERTEX = `#version 300 es
void main() {
  // One oversized triangle rather than a quad: no seam down the diagonal and
  // one less vertex to think about.
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform vec3 uHalf;        // half-extent of the box, in kilometres
uniform vec3 uEye;         // camera position, same frame
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uViewport;
uniform vec3 uPlaneNormal; // the cut; everything on its positive side is gone
uniform vec3 uPlanePoint;  // and it passes through here, not through the origin
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uSteps;

out vec4 fragColour;

/** Where a ray enters and leaves the box, or nothing. */
bool hitBox(vec3 origin, vec3 direction, out float near, out float far) {
  vec3 inverse = 1.0 / direction;
  vec3 a = (-uHalf - origin) * inverse;
  vec3 b = (uHalf - origin) * inverse;
  vec3 low = min(a, b);
  vec3 high = max(a, b);
  near = max(max(low.x, low.y), low.z);
  far = min(min(high.x, high.y), high.z);
  return far > max(near, 0.0);
}

vec3 toTexture(vec3 p) { return (p + uHalf) / (2.0 * uHalf); }

/** Reflectivity in dBZ, and how well that voxel was actually seen. */
vec2 sampleField(vec3 p) {
  vec2 raw = texture(uVolume, toTexture(p)).rg;
  return vec2(raw.r * 255.0 / uDbzScale + uDbzFloor, raw.g);
}

/**
 * The gradient of what is drawn, which is what gives the cloud its shape.
 *
 * Taken over reflectivity weighted by confidence rather than over reflectivity
 * alone: at the edge of coverage the field simply stops, and lighting that
 * boundary would carve a bright rim onto the place where the radar ran out.
 */
vec3 fieldNormal(vec3 p, float step) {
  vec3 d = vec3(step, 0.0, 0.0);
  float dx = dot(sampleField(p + d.xyz), vec2(0.02, 1.0)) - dot(sampleField(p - d.xyz), vec2(0.02, 1.0));
  float dy = dot(sampleField(p + d.zxy), vec2(0.02, 1.0)) - dot(sampleField(p - d.zxy), vec2(0.02, 1.0));
  float dz = dot(sampleField(p + d.yzx), vec2(0.02, 1.0)) - dot(sampleField(p - d.yzx), vec2(0.02, 1.0));
  vec3 g = vec3(dx, dy, dz);
  return length(g) > 1e-5 ? normalize(-g) : vec3(0.0, 0.0, 1.0);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  ndc.x *= uViewport.x / uViewport.y;
  // A narrow field of view, about 42 degrees across the short side. Wider
  // looks like a fisheye at this distance and, more to the point, leaves the
  // storm small in a panel that is only two hundred pixels tall.
  vec3 direction = normalize(uForward + (uRight * ndc.x + uUp * ndc.y) * 0.38);

  float near, far;
  if (!hitBox(uEye, direction, near, far)) { fragColour = vec4(0.0); return; }
  near = max(near, 0.0);

  // The cut, done to the ray rather than to every sample along it.
  //
  // Testing each sample and skipping it works, but the first sample that
  // survives lands wherever the march happens to put it, so the exposed face
  // comes out as a staircase one step deep. Trimming the interval against the
  // plane instead puts the face exactly on it, costs two operations rather
  // than one per step, and makes the cut surface the thing the ray starts on.
  float facing = dot(direction, uPlaneNormal);
  float atPlane = dot(uPlanePoint - uEye, uPlaneNormal);
  bool cutFace = false;
  if (abs(facing) < 1e-6) {
    // Parallel: the whole ray is on one side or the other.
    if (atPlane < 0.0) { fragColour = vec4(0.0); return; }
  } else {
    float t = atPlane / facing;
    if (facing > 0.0) {
      far = min(far, t);
    } else if (t > near) {
      near = t;
      cutFace = true;
    }
  }
  if (far <= near) { fragColour = vec4(0.0); return; }

  float dt = (far - near) / uSteps;
  vec3 light = normalize(vec3(-0.45, -0.7, 0.75));
  vec4 accumulated = vec4(0.0);

  // Start each ray a random fraction of a step in.
  //
  // Neighbouring rays otherwise sample at the same depths, so a sharp boundary
  // in the field -- the edge of a radar's coverage, say -- lands between the
  // same two steps all the way along it and comes out as a staircase. Jittered,
  // the same error becomes fine noise, which the eye reads as texture rather
  // than as a feature of the storm.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  for (float i = 0.0; i < uSteps; i += 1.0) {
    vec3 p = uEye + direction * (near + dt * (i + dither));
    vec2 field = sampleField(p);
    float density = smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, field.x) * field.y;
    if (density <= 0.002) continue;

    vec3 colour = texture(uRamp, vec2(clamp((field.x + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;

    float alpha;
    if (cutFace && i < 1.0) {
      // The sliced surface itself, drawn flat and solid: the whole point of
      // cutting the storm open is that this face shows structure the outside
      // hides, and shading it like more cloud would throw that away.
      //
      // Averaged over a second tap just behind it, because one opaque sample
      // of a trilinearly filtered texture facets along the voxel grid, and on
      // a flat bright surface those facets are the most visible thing in the
      // picture.
      vec2 behind = sampleField(p + direction * dt * 0.5);
      float smoothed = 0.5 * (density + smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, behind.x) * behind.y);
      alpha = clamp(smoothed * 2.1, 0.0, 1.0);
      colour *= 1.12;
    } else {
      vec3 normal = fieldNormal(p, dt);
      float lambert = 0.42 + 0.58 * max(dot(normal, light), 0.0);
      alpha = clamp(density * dt * 0.62, 0.0, 1.0);
      colour *= lambert;
    }

    accumulated.rgb += (1.0 - accumulated.a) * colour * alpha;
    accumulated.a += (1.0 - accumulated.a) * alpha;
    if (accumulated.a > 0.985) break;
  }

  fragColour = accumulated;
}`;

function compile(context: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = context.createShader(type)!;
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    throw new Error(context.getShaderInfoLog(shader) ?? "shader would not compile");
  }
  return shader;
}

/**
 * The reflectivity ramp as a texture the shader can look up.
 *
 * In the radar map's own palette, so a core that reads as severe there reads
 * as severe here. Spanning -32 to +64 dBZ, which is the range the stored byte
 * covers.
 */
function rampTexture(context: WebGL2RenderingContext, colormap: string): WebGLTexture {
  const pixels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const [r, g, b] = dbzColour(-32 + (i / 255) * 96, colormap);
    pixels.set([r, g, b, 255], i * 4);
  }
  const texture = context.createTexture()!;
  context.bindTexture(context.TEXTURE_2D, texture);
  context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 256, 1, 0, context.RGBA, context.UNSIGNED_BYTE, pixels);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  return texture;
}

function volumeTexture(context: WebGL2RenderingContext, loaded: Cutaway): WebGLTexture {
  const { header, voxels } = loaded;
  const texture = context.createTexture()!;
  context.bindTexture(context.TEXTURE_3D, texture);
  context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
  context.texImage3D(
    context.TEXTURE_3D, 0, context.RG8,
    header.nx, header.ny, header.nz, 0,
    context.RG, context.UNSIGNED_BYTE, voxels,
  );
  // Clamped rather than wrapped: a ray leaving the box must find empty air, not
  // the far side of the storm folded back in.
  for (const axis of [context.TEXTURE_WRAP_S, context.TEXTURE_WRAP_T, context.TEXTURE_WRAP_R]) {
    context.texParameteri(context.TEXTURE_3D, axis, context.CLAMP_TO_EDGE);
  }
  context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  return texture;
}

/** Where the camera stands and what it looks at, in the box's own kilometres. */
export interface RaymarchView {
  eye: Vec3;
  target: Vec3;
  /** The cut: everything on the side this points to is gone. */
  planeNormal: Vec3;
  /** A point the cut passes through. */
  planePoint: Vec3;
}

export interface Raymarcher {
  render(view: RaymarchView): void;
  dispose(): void;
}

/**
 * Set a canvas up to draw one storm's volume, or say why it cannot.
 *
 * Kilometres, and the same on every axis: a kilometre up is a kilometre
 * across, so a storm that looks tall and narrow is tall and narrow. The box
 * is centred on the origin, so its floor -- the ground -- is at minus half
 * its height.
 */
export function createRaymarcher(canvas: HTMLCanvasElement, loaded: Cutaway, colormap: string): Raymarcher | string {
  const context = canvas.getContext("webgl2", { alpha: true, antialias: false });
  if (!context) return "no webgl2";

  const program = context.createProgram()!;
  context.attachShader(program, compile(context, context.VERTEX_SHADER, VERTEX));
  context.attachShader(program, compile(context, context.FRAGMENT_SHADER, FRAGMENT));
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    return context.getProgramInfoLog(program) ?? "shader would not link";
  }
  context.useProgram(program);

  const at = (name: string) => context.getUniformLocation(program, name);
  context.activeTexture(context.TEXTURE0);
  volumeTexture(context, loaded);
  context.uniform1i(at("uVolume"), 0);
  context.activeTexture(context.TEXTURE1);
  rampTexture(context, colormap);
  context.uniform1i(at("uRamp"), 1);

  const half: Vec3 = [loaded.extentM[0] / 2000, loaded.extentM[1] / 2000, loaded.extentM[2] / 2000];
  context.uniform3fv(at("uHalf"), half);
  context.uniform1f(at("uDbzFloor"), loaded.header.dbz_floor);
  context.uniform1f(at("uDbzScale"), loaded.header.dbz_scale);
  context.uniform1f(at("uSteps"), STEPS);

  context.enable(context.BLEND);
  context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);

  return {
    render({ eye, target, planeNormal, planePoint }) {
      const forward: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
      const length = Math.hypot(...forward);
      const f = forward.map((v) => v / length) as Vec3;
      // World up is z, so right is f x z normalised and up closes the basis.
      const rl = Math.hypot(f[1], f[0]) || 1;
      const r: Vec3 = [f[1] / rl, -f[0] / rl, 0];
      const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];

      context.uniform3fv(at("uEye"), eye);
      context.uniform3fv(at("uForward"), f);
      context.uniform3fv(at("uRight"), r);
      context.uniform3fv(at("uUp"), u);
      context.uniform3fv(at("uPlaneNormal"), planeNormal);
      context.uniform3fv(at("uPlanePoint"), planePoint);
      context.uniform2fv(at("uViewport"), [canvas.width, canvas.height]);

      context.viewport(0, 0, canvas.width, canvas.height);
      context.clearColor(0, 0, 0, 0);
      context.clear(context.COLOR_BUFFER_BIT);
      context.drawArrays(context.TRIANGLES, 0, 3);
    },
    dispose() {
      context.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
