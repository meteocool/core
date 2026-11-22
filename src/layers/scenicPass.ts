/**
 * What a scenic sky draws besides its clouds' shape (cellVolumeLayer's
 * `ScenicPass`): its sun, the smaller picture its clouds are drawn in
 * before they are laid over the map, and the core of a storm seen through,
 * over its cloud.
 *
 * Studio's flight has such a sky and brings this with it: the storm layer
 * is the map's, loaded by everyone who opens it, and none of this is.
 */
import type { Cutaway } from "../lib/cellCutaway";
import { drawnPart, echoPart, overlap, type BoxPart } from "../lib/volumeBox";
import { apply, compile, invert, screenRect, type Mat4, type ScenicPass } from "./cellVolumeLayer";

/*
 * The sun: a disc and its glare, in the open sky only.
 *
 * Drawn at the far end of the depth range, so the ground hides it, and
 * before the clouds, so they do. Where it is in the picture comes from the
 * four rays through the picture's corners, worked out outside the shader:
 * on the map a ray's two ends differ by a few millionths, which a shader's
 * floats lose.
 */
const SUN_VERTEX = `#version 300 es
out vec2 vAt;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vAt = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 1.0, 1.0);
}`;

const SUN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
uniform vec3 uRay[4];   // bottom left, bottom right, top left, top right
uniform vec3 uSun;
out vec4 colour;
void main() {
  vec3 ray = normalize(mix(mix(uRay[0], uRay[1], vAt.x), mix(uRay[2], uRay[3], vAt.x), vAt.y));
  float towards = max(dot(ray, uSun), 0.0);
  float disc = smoothstep(0.99972, 0.99988, towards);
  // Its glare: tight round the disc, and a wide faint one that whitens that quarter of the sky.
  float glare = 0.5 * pow(towards, 700.0) + 0.17 * pow(towards, 70.0) + 0.06 * pow(towards, 9.0);
  colour = vec4(vec3(1.0, 0.96, 0.88) * (disc * 1.3 + glare), 0.0);
}`;

/*
 * A picture drawn somewhere else, laid over this one: the clouds, which are
 * drawn smaller and stretched.
 *
 * Smoothed as it is stretched, by its edges: each point is the average of
 * the picture's points round it, each weighed by how like the middle one it
 * is. The steps a cloud is marched in leave a fine weave in it, a few
 * hundredths either way, which this averages out; the edge of a cloud
 * against the sky, or of a core against its cloud, differs by far more, and
 * is left as sharp as it was drawn.
 */
const LAY_VERTEX = `#version 300 es
out vec2 vAt;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vAt = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const LAY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
uniform sampler2D uPicture;
out vec4 colour;
// How unlike the middle a neighbour may be and still count: the weave's few hundredths, not an edge's tenths.
const float LIKE = 32.0;
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uPicture, 0));
  vec4 middle = texture(uPicture, vAt);
  vec4 sum = middle;
  float weight = 1.0;
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      if (x == 0 && y == 0) continue;
      vec4 near = texture(uPicture, vAt + vec2(x, y) * texel);
      vec4 apart = near - middle;
      // The corners count for less than the sides: a round blur, not a square one.
      float w = exp(-dot(apart, apart) * LIKE) * (x == 0 || y == 0 ? 1.0 : 0.6);
      sum += near * w;
      weight += w;
    }
  }
  colour = sum / weight;
}`;

/*
 * A storm seen through: its core, over the picture of its cloud.
 *
 * The white cloud is opaque a few hundred metres in, so nothing drawn as
 * part of it shows from inside it. This is drawn after it instead, over the
 * picture the clouds are in, and by the echo alone: each ray goes through
 * the whole of the box, and what it finds of the core is laid over whatever
 * cloud the picture has there. The cloud stays as it was all round it.
 *
 * In the colour of the strongest echo the ray meets, which is how the radar
 * beneath is read: a pixel in the palette's red has that much somewhere
 * along it, with nothing weaker in front to tint it another colour. How
 * solid it is drawn is how much core the ray goes through, so the core is
 * soft where it is thin, at its edge, and the cloud's own shading shows
 * through it there.
 *
 * What it costs: one lookup a step, where the cloud spends a dozen on its
 * shape and its light, and only through the part of the box that holds
 * echo that strong (`coreBox`), which of a storm's tile is a small part.
 * In a picture as small as the clouds' own, whatever the map's pixels are.
 */
/**
 * How a core is drawn. `from` is the most its floor is ever put at, in dBZ:
 * echo that strong is core in any storm, however much stronger the storm's
 * own is. It comes in over `band` dBZ from its floor, a kilometre of it
 * `perKm` solid. What it hides of the cloud it is in goes by the strongest
 * echo on the ray, from `least` at the floor to `most` at `full` dBZ over
 * it: the weak part round a core is a tint on the cloud, which still shows
 * its light and shade through it, and the core itself is nearly solid.
 * Never quite: that is what keeps it inside the cloud and not on it.
 */
const CORE = { from: 40, band: 6, full: 14, perKm: "0.7", least: "0.25", most: "0.94" } as const;

const CORE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vAt;
uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform mat4 uInverse;
uniform mat4 uForward;
uniform vec2 uViewport;
uniform vec3 uExtentKm;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uSteps;
uniform float uLow;
uniform float uWeight;
uniform vec2 uDepthRange;
uniform vec2 uAt;
uniform float uReach;
out vec4 colour;

vec3 unproject(vec2 ndc, float z) {
  vec4 p = uInverse * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  vec3 origin = unproject(ndc, -1.0);
  vec3 direction = normalize(unproject(ndc, 1.0) - origin);
  vec3 a = (uBoxMin - origin) / direction;
  vec3 b = (uBoxMax - origin) / direction;
  vec3 low = min(a, b), high = max(a, b);
  float near = max(max(max(low.x, low.y), low.z), 0.0);
  float far = min(min(high.x, high.y), high.z);
  if (far <= near) discard;

  float count = clamp(ceil((far - near) * uSteps), 4.0, uSteps);
  float dt = (far - near) / count;
  float stepKm = dt * length(direction * uExtentKm);
  float strongest = -100.0;
  // The samples either side of the strongest: it lies between them, a little higher than any of the three.
  float before = -100.0;
  float after = -100.0;
  float last = -100.0;
  bool rising = false;
  float through = 0.0;
  float first = -1.0;
  for (float i = 0.0; i < uSteps; i += 1.0) {
    if (i >= count) break;
    // Every ray's samples at the same places along it: stepped at random
    // as the cloud's are, the strongest one found differs from each pixel to
    // the next, and where the palette changes colour that is grain.
    float t = near + dt * (i + 0.5);
    vec3 p = origin + direction * t;
    vec2 raw = texture(uVolume, p).rg;
    float dbz = raw.r * 255.0 / uDbzScale + uDbzFloor;
    float was = last;
    last = dbz;
    if (rising) after = dbz;
    rising = false;
    float core = smoothstep(uLow, uLow + ${CORE.band}.0, dbz) * raw.g;
    if (core <= 0.0) continue;
    // The storm looked into and what stands round it, thinning away with distance: there is no edge to it.
    core *= 1.0 - smoothstep(0.6 * uReach, uReach, length((p.xy - uAt) * uExtentKm.xy));
    if (core <= 0.0) continue;
    if (first < 0.0) first = t;
    if (dbz > strongest) {
      strongest = dbz;
      before = was;
      after = was;
      rising = true;
    }
    through += core * stepKm;
  }
  if (first < 0.0) discard;
  // The top of the curve through the three, where they are one: or a core
  // narrower than a step is as strong as wherever the steps happen to fall,
  // and its outline is a comb.
  float bend = before - 2.0 * strongest + after;
  if (before > -50.0 && bend < -1e-3) strongest += (before - after) * (before - after) / (-8.0 * bend);
  // The ground hides it, as it does the cloud it is in.
  vec4 clip = uForward * vec4(origin + direction * first, 1.0);
  gl_FragDepth = mix(uDepthRange.x, uDepthRange.y, clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0));
  float strength = smoothstep(uLow, uLow + ${CORE.full}.0, strongest);
  float alpha = (1.0 - exp(-through * uWeight * ${CORE.perKm})) * mix(${CORE.least}, ${CORE.most}, strength);
  vec3 paint = texture(uRamp, vec2(clamp((strongest + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;
  colour = vec4(paint * alpha, alpha);
}`;

/** Where the sun of the white cloud stands (the cloud shader's `SUN`), and of the glitter on the flight's water: east, north and up. */
export const SUN_DIRECTION: [number, number, number] = [-0.8, -0.25, 0.55];

function link(context: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = context.createProgram()!;
  context.attachShader(program, compile(context, context.VERTEX_SHADER, vertex));
  context.attachShader(program, compile(context, context.FRAGMENT_SHADER, fragment));
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    throw new Error(context.getProgramInfoLog(program) ?? "scenic pass would not link");
  }
  return program;
}

/** Where each volume holds echo of a floor or more: a pass over its voxels, kept while the floor stays, which is as long as one storm is looked into. */
const strongParts = new WeakMap<Pick<Cutaway, "header" | "voxels">, { low: number; part: BoxPart | null }>();

/**
 * The part of a storm's box its core is marched in: what holds any echo of
 * `low` dBZ or more, is its own to draw (`drawnPart`), and is within
 * `reachKm` of where the storm is looked into (`at`, on the ground, in the
 * box's cube); null with none. A ray's steps are spent only there, which of
 * a tile is a small part.
 */
export function coreBox(
  cutaway: Pick<Cutaway, "header" | "voxels" | "extentM">, low: number, at: readonly [number, number], reachKm: number,
): BoxPart | null {
  let known = strongParts.get(cutaway);
  if (known?.low !== low) {
    const echo = echoPart(cutaway, low);
    known = { low, part: echo && overlap(drawnPart(cutaway.header), echo) };
    strongParts.set(cutaway, known);
  }
  if (!known.part) return null;
  const [across, along] = [(reachKm * 1000) / cutaway.extentM[0], (reachKm * 1000) / cutaway.extentM[1]];
  const box = overlap(known.part, { min: [at[0] - across, at[1] - along, 0], max: [at[0] + across, at[1] + along, 1] });
  return box.min.every((least, axis) => least < box.max[axis]) ? box : null;
}

/**
 * Laying the cores over the map later than the clouds are: after whatever
 * else is drawn over the world that a storm seen through should be seen
 * through too, which is the cloud round the eye (weatherPass.ts). `asked`
 * once somebody has: from then on a frame's cores wait for it.
 */
let layLate: (() => void) | null = null;
let asked = false;

/**
 * Lay the cores of the storm seen through over the map now, this frame's,
 * where there are any. For whoever draws over the world after the clouds:
 * called every frame from there, the cores go over that as well; never
 * called, they are laid with the clouds.
 */
export function layCoresLate(): void {
  asked = true;
  layLate?.();
}

export function makeScenicPass(context: WebGL2RenderingContext): ScenicPass {
  const sunProgram = link(context, SUN_VERTEX, SUN_FRAGMENT);
  const layProgram = link(context, LAY_VERTEX, LAY_FRAGMENT);
  /** The shader a storm's core is drawn with, made the first time one is looked into. */
  let coreProgram: WebGLProgram | null = null;
  const coreUniforms = new Map<string, WebGLUniformLocation | null>();
  /**
   * Where the clouds are drawn before they are laid over the map: a picture
   * of their own, smaller than the map's. Their shader is several times the
   * map's own, and a cloud has no edge that a half-size picture loses; with
   * the map's depths copied into it, the ground still hides them. `false`
   * once a machine has refused it: then they are drawn straight onto the
   * map, at its size and cost.
   */
  let aside: { framebuffer: WebGLFramebuffer; picture: WebGLTexture; depth: WebGLRenderbuffer; width: number; height: number } | false | null = null;
  let tried = false;
  /** Whether the clouds are being drawn into that picture now: between `begin` and `end`. */
  let begun = false;
  /**
   * A second picture of that size, with the same depths under it, for the
   * cores of a storm seen through where they are not drawn straight into
   * the clouds' own; `false` once a machine has refused it.
   */
  let over: { framebuffer: WebGLFramebuffer; picture: WebGLTexture } | false | null = null;
  /** The map's size, while a frame's cores wait in that picture to be laid over it; see `layCoresLate`. */
  let waiting: { width: number; height: number } | null = null;

  function drop(): void {
    if (over) {
      context.deleteFramebuffer(over.framebuffer);
      context.deleteTexture(over.picture);
    }
    over = null;
    if (!aside) return;
    context.deleteFramebuffer(aside.framebuffer);
    context.deleteTexture(aside.picture);
    context.deleteRenderbuffer(aside.depth);
    aside = null;
  }

  /** A texture to draw a picture into and stretch over the map after. */
  function pictureOf(width: number, height: number): WebGLTexture {
    const picture = context.createTexture()!;
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, picture);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, width, height, 0, context.RGBA, context.UNSIGNED_BYTE, null);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.bindTexture(context.TEXTURE_2D, null);
    return picture;
  }

  /** A framebuffer of a picture over a depth buffer; null where this machine will not have it. */
  function framed(picture: WebGLTexture, depth: WebGLRenderbuffer): WebGLFramebuffer | null {
    const framebuffer = context.createFramebuffer()!;
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, picture, 0);
    context.framebufferRenderbuffer(context.FRAMEBUFFER, context.DEPTH_STENCIL_ATTACHMENT, context.RENDERBUFFER, depth);
    const whole = context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    if (!whole) context.deleteFramebuffer(framebuffer);
    return whole ? framebuffer : null;
  }

  /** The picture, made or made again for the map's size; null where there is to be none. */
  function asideFor(width: number, height: number) {
    if (aside === false) return null;
    if (aside && aside.width === width && aside.height === height) return aside;
    drop();
    const picture = pictureOf(width, height);
    const depth = context.createRenderbuffer()!;
    context.bindRenderbuffer(context.RENDERBUFFER, depth);
    context.renderbufferStorage(context.RENDERBUFFER, context.DEPTH24_STENCIL8, width, height);
    context.bindRenderbuffer(context.RENDERBUFFER, null);
    const framebuffer = framed(picture, depth);
    tried = false;
    if (!framebuffer) {
      context.deleteTexture(picture);
      context.deleteRenderbuffer(depth);
      aside = false;
      return null;
    }
    aside = { framebuffer, picture, depth, width, height };
    return aside;
  }

  /**
   * That picture at a share of the map's size, with the map's depths in it,
   * so its ground hides what is drawn there as it would here; null where
   * there is to be none.
   */
  function asideWithDepths(mapWidth: number, mapHeight: number, scale: number) {
    const width = Math.max(1, Math.ceil(mapWidth * scale));
    const height = Math.max(1, Math.ceil(mapHeight * scale));
    const apart = asideFor(width, height);
    if (!apart) return null;
    context.bindFramebuffer(context.READ_FRAMEBUFFER, null);
    context.bindFramebuffer(context.DRAW_FRAMEBUFFER, apart.framebuffer);
    context.blitFramebuffer(0, 0, mapWidth, mapHeight, 0, 0, width, height, context.DEPTH_BUFFER_BIT, context.NEAREST);
    if (!tried) {
      // Asked once: a machine that will not copy depths between the two says so here.
      tried = true;
      if (context.getError() !== context.NO_ERROR) {
        context.bindFramebuffer(context.FRAMEBUFFER, null);
        drop();
        aside = false;
        return null;
      }
    }
    return apart;
  }

  /** The cores' own picture over the clouds' depths, made the first time it is wanted; null where there is to be none. */
  function overFor(apart: { depth: WebGLRenderbuffer; width: number; height: number }): WebGLFramebuffer | null {
    if (over === null) {
      const picture = pictureOf(apart.width, apart.height);
      const framebuffer = framed(picture, apart.depth);
      if (!framebuffer) context.deleteTexture(picture);
      over = framebuffer ? { framebuffer, picture } : false;
    }
    return over ? over.framebuffer : null;
  }

  /** Stretch a picture over the map: the ground has had its say in it already. */
  function lay(picture: WebGLTexture, mapWidth: number, mapHeight: number): void {
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    context.viewport(0, 0, mapWidth, mapHeight);
    context.disable(context.DEPTH_TEST);
    context.useProgram(layProgram);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, picture);
    context.uniform1i(context.getUniformLocation(layProgram, "uPicture"), 0);
    context.drawArrays(context.TRIANGLES, 0, 3);
    context.bindTexture(context.TEXTURE_2D, null);
  }

  /** The cores that are waiting, over the map: from wherever in the frame, so with nothing taken as set. */
  const layWaiting = () => {
    if (!waiting || !over) return;
    const { width, height } = waiting;
    waiting = null;
    context.disable(context.SCISSOR_TEST);
    context.disable(context.STENCIL_TEST);
    context.disable(context.CULL_FACE);
    context.colorMask(true, true, true, true);
    context.enable(context.BLEND);
    context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
    lay(over.picture, width, height);
  };
  layLate = layWaiting;

  return {
    drawSun(main: Mat4) {
      const back = invert(main);
      if (!back) return;
      // The ray through each corner of the picture, on the map: east, south (as its y runs) and up.
      const rays = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).flatMap(([x, y]) => {
        const [nx, ny, nz, nw] = apply(back, x, y, -1);
        const [fx, fy, fz, fw] = apply(back, x, y, 1);
        const ray = [fx / fw - nx / nw, fy / fw - ny / nw, fz / fw - nz / nw];
        const length = Math.hypot(...ray) || 1;
        return ray.map((part) => part / length);
      });
      const [east, north, up] = SUN_DIRECTION;
      const length = Math.hypot(east, north, up);
      context.useProgram(sunProgram);
      context.uniform3fv(context.getUniformLocation(sunProgram, "uRay"), new Float32Array(rays));
      context.uniform3f(context.getUniformLocation(sunProgram, "uSun"), east / length, -north / length, up / length);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LEQUAL);
      context.depthMask(false);
      context.disable(context.CULL_FACE);
      context.disable(context.SCISSOR_TEST);
      context.enable(context.BLEND);
      context.blendFunc(context.ONE, context.ONE);
      context.drawArrays(context.TRIANGLES, 0, 3);
    },

    begin(mapWidth, mapHeight, scale) {
      const apart = asideWithDepths(mapWidth, mapHeight, scale);
      if (!apart) return null;
      const { width, height } = apart;
      context.bindFramebuffer(context.FRAMEBUFFER, apart.framebuffer);
      context.viewport(0, 0, width, height);
      context.disable(context.SCISSOR_TEST);
      context.colorMask(true, true, true, true);
      context.clearColor(0, 0, 0, 0);
      context.clear(context.COLOR_BUFFER_BIT);
      begun = true;
      return { width, height };
    },

    end(mapWidth, mapHeight) {
      begun = false;
      if (aside) lay(aside.picture, mapWidth, mapHeight);
    },

    drawCores(cores, floor, reachKm, ramp, mapWidth, mapHeight, scale) {
      // A frame's cores never fetched: nobody lays them late any more.
      if (waiting) asked = false;
      waiting = null;
      // Into the clouds' picture while that is being drawn and the two are
      // laid together. Else into one of their own, as small: laid later,
      // over more than the clouds; or at once, where the clouds went
      // straight onto the map, which is many times the pixels.
      const among = begun && aside ? aside : null;
      const apart = among && !asked ? null : among ?? asideWithDepths(mapWidth, mapHeight, scale);
      const own = apart && overFor(apart);
      const { width, height } = own ? apart! : among ?? { width: mapWidth, height: mapHeight };
      context.bindFramebuffer(context.FRAMEBUFFER, own || (among ? among.framebuffer : null));
      context.viewport(0, 0, width, height);
      if (own) {
        context.disable(context.SCISSOR_TEST);
        context.colorMask(true, true, true, true);
        context.clearColor(0, 0, 0, 0);
        context.clear(context.COLOR_BUFFER_BIT);
      }
      const low = Math.min(floor, CORE.from);
      coreProgram ??= link(context, LAY_VERTEX, CORE_FRAGMENT);
      const program = coreProgram;
      const at = (name: string) => {
        if (!coreUniforms.has(name)) coreUniforms.set(name, context.getUniformLocation(program, name));
        return coreUniforms.get(name) ?? null;
      };
      // As the clouds were drawn: over what is there, the ground's depths tested and none written.
      context.useProgram(program);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, ramp);
      context.uniform1i(at("uRamp"), 1);
      context.uniform1i(at("uVolume"), 0);
      context.uniform2f(at("uViewport"), width, height);
      const [depthNear, depthFar] = context.getParameter(context.DEPTH_RANGE) as Float32Array;
      context.uniform2f(at("uDepthRange"), depthNear, depthFar);
      context.uniform1f(at("uLow"), low);
      context.uniform1f(at("uReach"), reachKm);
      context.activeTexture(context.TEXTURE0);
      context.enable(context.SCISSOR_TEST);
      for (const { cutaway, texture, forward, inverse, at: where, steps, weight } of cores) {
        const { header, extentM } = cutaway;
        const box = coreBox(cutaway, low, where, reachKm);
        if (!box) continue;
        const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner): [number, number, number] => [
          corner & 1 ? box.max[0] : box.min[0], corner & 2 ? box.max[1] : box.min[1], corner & 4 ? box.max[2] : box.min[2],
        ]);
        const rect = screenRect(forward, corners, width, height);
        if (!rect) continue;
        context.scissor(rect[0], rect[1], rect[2], rect[3]);
        context.bindTexture(context.TEXTURE_3D, texture);
        context.uniformMatrix4fv(at("uForward"), false, new Float32Array(forward));
        context.uniformMatrix4fv(at("uInverse"), false, new Float32Array(inverse));
        context.uniform3f(at("uExtentKm"), extentM[0] / 1000, extentM[1] / 1000, extentM[2] / 1000);
        context.uniform3f(at("uBoxMin"), ...box.min);
        context.uniform3f(at("uBoxMax"), ...box.max);
        // Twice the cloud's: a step is one lookup here, and the strongest echo along a ray is found only as finely as it is looked for.
        context.uniform1f(at("uSteps"), Math.max(16, Math.round(steps * 2)));
        context.uniform1f(at("uDbzFloor"), header.dbz_floor);
        context.uniform1f(at("uDbzScale"), header.dbz_scale);
        context.uniform1f(at("uWeight"), weight);
        context.uniform2f(at("uAt"), where[0], where[1]);
        context.drawArrays(context.TRIANGLES, 0, 3);
      }
      if (!own) return;
      // Back to where the clouds are drawn, for what the layer does next.
      context.bindFramebuffer(context.FRAMEBUFFER, among ? among.framebuffer : null);
      if (!among) context.viewport(0, 0, mapWidth, mapHeight);
      context.disable(context.SCISSOR_TEST);
      waiting = { width: mapWidth, height: mapHeight };
      if (!asked) layWaiting();
    },

    dispose() {
      if (layLate === layWaiting) layLate = null;
      drop();
      context.deleteProgram(sunProgram);
      context.deleteProgram(layProgram);
      if (coreProgram) context.deleteProgram(coreProgram);
    },
  };
}
