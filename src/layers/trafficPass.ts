/**
 * The other aircraft of the airspace, drawn into the flight's picture
 * before its own aircraft (aircraftLayer.ts), so the cockpit and the
 * airframe cover whatever is behind them.
 *
 * Every aircraft is placed against the flight's own, in the sky's metres
 * (lib/studio/flight/airspace/sky.ts): north, east and down of it, heights
 * drawn as tall as the map draws them. One matrix takes those to the
 * camera, the eye's own (`Sight`). What each aircraft is drawn as, and how
 * many of each, is the budget's (airspace/budget.ts): near ones the light
 * model, all of them in one instanced draw; further ones its silhouette,
 * in another; beyond that a strobe each, all of them one draw of points;
 * and every contrail one instanced ribbon. The nearest few that burn or
 * have blown up get their fire, smoke and blast from the cockpit's own
 * sprites (aircraftEffects.ts), within that pass's cap.
 *
 * Each kind has its own depth range, the silhouettes' first, then the
 * models' with the depth cleared, so neither is cut off by the other's
 * lens. They are not tested against the clouds or the ground: the map's
 * depth is not theirs to share. An aircraft on the ground more than a few
 * kilometres off is not drawn at all: it is in the haze, and most likely
 * behind the terrain.
 *
 * Nothing is made anew on a frame: every array is kept and refilled.
 */
import type { TrafficPass } from "./aircraftLayer";
import { skyLighting } from "./aircraftRenderer";
import { effectSprites, makeEffectsPass, MAX_SPRITES, SPRITE_FLOATS } from "./aircraftEffects";
import type { AircraftEffects } from "./aircraftRenderer";
import type { EffectsPass } from "./aircraftEffects";
import { perspective, inAircraft } from "../lib/studio/flight/view";
import { throughWindows } from "../lib/studio/flight/cockpit";
import type { Sight } from "../lib/studio/flight/pilot";
import { AS_LIGHT, AS_MODEL, AS_SILHOUETTE, BURNING_M, budgetFor, choose, LIGHT_FROM_M, MODEL_M, SILHOUETTE_M } from "../lib/studio/flight/airspace/budget";
import { FIRE_PLACES } from "../lib/studio/flight/airspace/look";
import type { LightMesh, LightModel } from "../lib/studio/flight/airspace/lightModel";
import { LIGHT_VERTEX_BYTES } from "../lib/studio/flight/airspace/lightModel";
import { LABEL_M } from "../lib/studio/flight/airspace/shared";
import type { TrafficShared } from "../lib/studio/flight/airspace/shared";
import { Sky } from "../lib/studio/flight/airspace/sky";
import { contrailStrength, SEGMENT_FLOATS, Trail, TRAIL_S, warmerThanStandard } from "../lib/studio/flight/airspace/trails";
import type { OtherAircraft } from "../lib/studio/flight/airspace/traffic";
import { GEAR_DOWN, ON_GROUND } from "../lib/studio/flight/airspace/wire";

type Vec3 = [number, number, number];

/** Floats an instance of the model or the silhouette takes: where (3), its forward and right (3 each), how much is seen, gear down, a number of its own. */
const INSTANCE_FLOATS = 12;
/** Floats a light takes: where (3), how bright (1), a number of its own (1). */
const LIGHT_FLOATS = 5;
/** The lenses' near and far, metres: the models', the silhouettes', and the lights', contrails' and fires'. */
const MODEL_RANGE: [number, number] = [3, MODEL_M * 1.3];
const SILHOUETTE_RANGE: [number, number] = [40, SILHOUETTE_M * 1.3];
const FAR_RANGE: [number, number] = [5, 500_000];
/** An aircraft on the ground further than this is not drawn, metres. */
const GROUND_SEEN_M = 4000;
/** How far through cloud and rain an aircraft is seen, metres, as the aircraft outside is (pilot.ts). */
const CLOUD_SEEN_M = 45;
const RAIN_SEEN_M = 320;
/** The light outside, as the aircraft outside is lit: ambient, lit side, turned away. */
const OUTSIDE_LIGHTING: Vec3 = [0.5, 0.62, 0.05];
/** A blast's fire and smoke go on this long after its aircraft is forgotten, s; a fire this long. */
const LINGER_S = 8;
/** At most this many burning aircraft are drawn, whatever the budget says. */
const BURNING_MOST = 4;

const MODEL_VERTEX = `#version 300 es
layout(location = 0) in vec4 aPlace;
layout(location = 1) in vec4 aNormal;
layout(location = 2) in vec4 aColour;
layout(location = 3) in vec3 aAt;
layout(location = 4) in vec3 aForward;
layout(location = 5) in vec3 aRight;
layout(location = 6) in vec3 aLook;
uniform mat4 uWorldView;
uniform mat4 uProjection;
uniform vec3 uExtent;
uniform vec3 uSun;
uniform vec3 uLighting;
out vec3 vColour;
out float vOpacity;
void main() {
  vec3 body = aPlace.xyz * uExtent;
  // The gear folded away where its aircraft has it up: all of it to one point, which draws nothing.
  if (aPlace.w > 0.5 && aLook.y < 0.5) body = vec3(0.0, 0.0, 1.0);
  vec3 down = cross(aForward, aRight);
  vec3 world = aAt + aForward * body.x + aRight * body.y + down * body.z;
  vec3 normal = normalize(aForward * aNormal.x + aRight * aNormal.y + down * aNormal.z);
  float facing = dot(normal, uSun);
  float light = uLighting.x + uLighting.y * max(facing, 0.0) + uLighting.z * max(-facing, 0.0);
  vColour = aColour.rgb * light;
  vOpacity = aLook.x;
  gl_Position = uProjection * uWorldView * vec4(world, 1.0);
}`;

const MODEL_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColour;
in float vOpacity;
out vec4 colour;
void main() {
  colour = vec4(vColour * vOpacity, vOpacity);
}`;

const LIGHT_VERTEX = `#version 300 es
layout(location = 0) in vec3 aAt;
layout(location = 1) in vec2 aLight;
uniform mat4 uWorldView;
uniform mat4 uProjection;
uniform float uTime;
uniform float uPixel;
out float vBright;
void main() {
  vec4 seen = uWorldView * vec4(aAt, 1.0);
  // A white flash about once a second, two quick ones, each aircraft at its own moment; and a dim glint between.
  float phase = fract(uTime * 1.05 + aLight.y * 0.618);
  float flash = phase < 0.05 ? 1.0 : (phase > 0.12 && phase < 0.16 ? 0.8 : 0.0);
  vBright = aLight.x * (0.3 + 0.7 * flash);
  gl_PointSize = uPixel * (flash > 0.0 ? 4.0 : 2.0);
  gl_Position = uProjection * seen;
}`;

const LIGHT_FRAGMENT = `#version 300 es
precision highp float;
in float vBright;
out vec4 colour;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vBright * (1.0 - smoothstep(0.4, 1.0, r));
  colour = vec4(vec3(a), a);
}`;

const TRAIL_VERTEX = `#version 300 es
layout(location = 0) in vec3 aFrom;
layout(location = 1) in vec3 aTo;
layout(location = 2) in vec3 aAge;
uniform mat4 uWorldView;
uniform mat4 uProjection;
uniform float uPixelAngle;
uniform float uLasts;
out float vAcross;
out float vAlpha;
void main() {
  float along = float(gl_VertexID & 1);
  float side = (gl_VertexID & 2) == 0 ? -1.0 : 1.0;
  vec3 from = (uWorldView * vec4(aFrom, 1.0)).xyz;
  vec3 to = (uWorldView * vec4(aTo, 1.0)).xyz;
  vec3 at = mix(from, to, along);
  float age = mix(aAge.x, aAge.y, along);
  float far = max(length(at), 1.0);
  // Spreading as it ages; never thinner than a pixel and a half, and fainter for being drawn wider than it is.
  float width = 3.0 + age * 1.1;
  float drawn = max(width, far * uPixelAngle * 1.5);
  vec3 across = normalize(cross(to - from + vec3(1e-4, 0.0, 0.0), at));
  at += across * side * drawn * 0.5;
  // Formed a moment behind its aircraft; gone as it ages.
  vAlpha = aAge.z * 0.6 * smoothstep(0.3, 2.0, age) * pow(max(1.0 - age / uLasts, 0.0), 1.5) * (width / drawn);
  vAcross = side;
  gl_Position = uProjection * vec4(at, 1.0);
}`;

const TRAIL_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
in float vAlpha;
uniform vec3 uColour;
out vec4 colour;
void main() {
  float a = vAlpha * (1.0 - vAcross * vAcross);
  colour = vec4(uColour * a, a);
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "traffic shader");
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "traffic program");
  return program;
}

/** What is kept of each aircraft between frames: its contrail, and when what burns on it began. */
interface Kept {
  trail: Trail;
  /** On the page's clock, s; null while nothing burns, or no blast has been seen. */
  fireBorn: number | null;
  blastBorn: number | null;
}

/** A burning aircraft drawn this frame, or lingering once forgotten: where, how it is turned, and what burns. */
interface Burning {
  north: number;
  east: number;
  down: number;
  forward: Vec3;
  right: Vec3;
  velocity: Vec3;
  burning: number;
  strength: number;
  fireBorn: number;
  blast: { size: number; born: number; seed: number } | null;
}

interface Lingering {
  lon: number;
  lat: number;
  altitude: number;
  until: number;
  state: Burning;
}

export interface TrafficSource {
  shared: TrafficShared;
  /** How the eye sees the world this frame. */
  sight: () => Sight | null;
  now: () => number;
}

const blankBurning = (): Burning => ({
  north: 0, east: 0, down: 0, forward: [1, 0, 0], right: [0, 1, 0], velocity: [0, 0, 0], burning: 0, strength: 0, fireBorn: 0, blast: null,
});

export function makeTrafficPass(source: TrafficSource, model: LightModel): TrafficPass & { dispose(): void } {
  const { shared } = source;
  const { traffic, drawn } = shared;
  let gl: WebGL2RenderingContext | null = null;
  let programs: { model: WebGLProgram; light: WebGLProgram; trail: WebGLProgram } | null = null;
  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const uniform = (program: WebGLProgram, name: string) => {
    let known = uniforms.get(program);
    if (!known) uniforms.set(program, (known = new Map()));
    if (!known.has(name)) known.set(name, gl!.getUniformLocation(program, name));
    return known.get(name) ?? null;
  };
  interface MeshGl { vao: WebGLVertexArrayObject; vertices: WebGLBuffer; indices: WebGLBuffer; instances: WebGLBuffer; count: number; capacity: number }
  let meshes: { model: MeshGl; silhouette: MeshGl } | null = null;
  let lightGl: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; capacity: number } | null = null;
  let trailGl: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; capacity: number } | null = null;
  let effects: EffectsPass | null = null;

  // Kept from frame to frame, and grown only when there are more aircraft than ever.
  let capacity = 0;
  let distance = new Float64Array(0);
  let kinds = new Uint8Array(0);
  let order = new Uint16Array(0);
  let north = new Float64Array(0);
  let east = new Float64Array(0);
  let down = new Float64Array(0);
  let models = new Float32Array(0);
  let silhouettes = new Float32Array(0);
  let lights = new Float32Array(0);
  let segments = new Float32Array(0);
  const sprites = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);
  const slotSprites = Array.from({ length: BURNING_MOST }, (_, i) => sprites.subarray(
    Math.floor((i * MAX_SPRITES) / BURNING_MOST) * SPRITE_FLOATS, Math.floor(((i + 1) * MAX_SPRITES) / BURNING_MOST) * SPRITE_FLOATS,
  ));
  const slotEffects: AircraftEffects[] = Array.from({ length: BURNING_MOST }, () => ({
    time: 0, fires: FIRE_PLACES.map(() => ({ at: [0, 0, 0] as Vec3, size: 0, strength: 0, born: 0 })), blasts: [{ at: [0, 0, 0] as Vec3, size: 0, born: 0 }],
    air: [0, 0, 0], up: [0, 0, -1],
  }));
  const fireList = slotEffects.map((effect) => effect.fires.slice());
  const blastList = slotEffects.map((effect) => effect.blasts.slice());
  const burningNow: Burning[] = Array.from({ length: BURNING_MOST }, blankBurning);
  const lingering: Lingering[] = [];
  const worldView = new Float32Array(16);
  const modelProjection = new Float32Array(16);
  const silhouetteProjection = new Float32Array(16);
  const farProjection = new Float32Array(16);
  const head: Vec3 = [0, 0, 0];
  const origin: Vec3 = [0, 0, 0];
  let sky: Sky | null = null;

  function grow(count: number): void {
    if (count <= capacity) return;
    capacity = Math.max(count, capacity * 2, 64);
    distance = new Float64Array(capacity);
    kinds = new Uint8Array(capacity);
    order = new Uint16Array(capacity);
    north = new Float64Array(capacity);
    east = new Float64Array(capacity);
    down = new Float64Array(capacity);
    models = new Float32Array(capacity * INSTANCE_FLOATS);
    silhouettes = new Float32Array(capacity * INSTANCE_FLOATS);
    lights = new Float32Array(capacity * LIGHT_FLOATS);
  }

  function meshGl(context: WebGL2RenderingContext, mesh: LightMesh): MeshGl {
    const vao = context.createVertexArray()!;
    context.bindVertexArray(vao);
    const vertices = context.createBuffer()!;
    context.bindBuffer(context.ARRAY_BUFFER, vertices);
    context.bufferData(context.ARRAY_BUFFER, mesh.vertices, context.STATIC_DRAW);
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 4, context.SHORT, true, LIGHT_VERTEX_BYTES, 0);
    context.enableVertexAttribArray(1);
    context.vertexAttribPointer(1, 4, context.BYTE, true, LIGHT_VERTEX_BYTES, 8);
    context.enableVertexAttribArray(2);
    context.vertexAttribPointer(2, 4, context.UNSIGNED_BYTE, true, LIGHT_VERTEX_BYTES, 12);
    const indices = context.createBuffer()!;
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indices);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, mesh.indices, context.STATIC_DRAW);
    const instances = context.createBuffer()!;
    context.bindBuffer(context.ARRAY_BUFFER, instances);
    context.bufferData(context.ARRAY_BUFFER, 64 * INSTANCE_FLOATS * 4, context.DYNAMIC_DRAW);
    for (const [location, offset] of [[3, 0], [4, 3], [5, 6], [6, 9]] as const) {
      context.enableVertexAttribArray(location);
      context.vertexAttribPointer(location, 3, context.FLOAT, false, INSTANCE_FLOATS * 4, offset * 4);
      context.vertexAttribDivisor(location, 1);
    }
    context.bindVertexArray(null);
    return { vao, vertices, indices, instances, count: mesh.indices.length, capacity: 64 };
  }

  function streamGl(context: WebGL2RenderingContext, floats: number, layout: ReadonlyArray<[number, number, number]>, divisor: number) {
    const vao = context.createVertexArray()!;
    context.bindVertexArray(vao);
    const buffer = context.createBuffer()!;
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(context.ARRAY_BUFFER, 256 * floats * 4, context.DYNAMIC_DRAW);
    for (const [location, size, offset] of layout) {
      context.enableVertexAttribArray(location);
      context.vertexAttribPointer(location, size, context.FLOAT, false, floats * 4, offset * 4);
      context.vertexAttribDivisor(location, divisor);
    }
    context.bindVertexArray(null);
    return { vao, buffer, capacity: 256 };
  }

  function setUp(context: WebGL2RenderingContext): void {
    gl = context;
    programs = {
      model: compile(context, MODEL_VERTEX, MODEL_FRAGMENT),
      light: compile(context, LIGHT_VERTEX, LIGHT_FRAGMENT),
      trail: compile(context, TRAIL_VERTEX, TRAIL_FRAGMENT),
    };
    meshes = { model: meshGl(context, model.model), silhouette: meshGl(context, model.silhouette) };
    lightGl = streamGl(context, LIGHT_FLOATS, [[0, 3, 0], [1, 2, 3]], 0);
    trailGl = streamGl(context, SEGMENT_FLOATS, [[0, 3, 0], [1, 3, 3], [2, 3, 6]], 1);
    context.bindBuffer(context.ARRAY_BUFFER, null);
  }

  /** Upload `count` records of `floats` each to `buffer`, growing it as needed. */
  function upload(
    context: WebGL2RenderingContext, target: { buffer?: WebGLBuffer; instances?: WebGLBuffer; capacity: number }, data: Float32Array, count: number, floats: number,
  ): void {
    const buffer = (target.instances ?? target.buffer)!;
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    if (count > target.capacity) {
      target.capacity = Math.max(count, target.capacity * 2);
      context.bufferData(context.ARRAY_BUFFER, target.capacity * floats * 4, context.DYNAMIC_DRAW);
    }
    context.bufferSubData(context.ARRAY_BUFFER, 0, data, 0, count * floats);
  }

  const keptOf = (aircraft: OtherAircraft): Kept => {
    let kept = aircraft.drawn as Kept | null;
    if (!kept) aircraft.drawn = kept = { trail: new Trail(), fireBorn: null, blastBorn: null };
    return kept;
  };

  /** An aircraft forgotten while it burns or has just blown up: its fire stays where it was, a while. */
  const gone = (aircraft: OtherAircraft) => {
    const kept = aircraft.drawn as Kept | null;
    const look = aircraft.look;
    if (!kept || (!look.burning && !look.blast) || lingering.length >= BURNING_MOST) return;
    const now = source.now() / 1000;
    const state = blankBurning();
    writeBurning(state, aircraft, kept, 0, 0, 0, now);
    lingering.push({ lon: aircraft.shown.lon, lat: aircraft.shown.lat, altitude: aircraft.shown.altitude, until: now + LINGER_S, state });
  };

  /** What burns on an aircraft, at a place north, east and down of the eye's aircraft. */
  function writeBurning(into: Burning, aircraft: OtherAircraft, kept: Kept, n: number, e: number, d: number, now: number): void {
    const { shown, look } = aircraft;
    into.north = n;
    into.east = e;
    into.down = d;
    axesOf(shown.heading, shown.pitch, shown.roll, into.forward, into.right);
    into.velocity[0] = shown.north;
    into.velocity[1] = shown.east;
    into.velocity[2] = -shown.up;
    into.burning = look.burning;
    into.strength = look.strength;
    if (look.burning) kept.fireBorn ??= now;
    else kept.fireBorn = null;
    into.fireBorn = kept.fireBorn ?? now;
    if (look.blast) {
      const born = now - look.blast.ago;
      // Heard again, the same blast: kept where it began; one more than a second and a half apart is a new one.
      if (kept.blastBorn === null || Math.abs(kept.blastBorn - born) > 1.5) kept.blastBorn = born;
      into.blast ??= { size: 0, born: 0, seed: 0 };
      into.blast.size = look.blast.size;
      into.blast.born = kept.blastBorn;
      into.blast.seed = look.blast.seed;
    } else {
      into.blast = null;
    }
  }

  /** Sprites of a burning aircraft, into slot `slot`, moved to where it is from the eye's aircraft. How many. */
  function spritesOf(slot: number, burning: Burning, now: number): number {
    const effect = slotEffects[slot];
    const fires = fireList[slot];
    effect.time = now;
    effect.fires.length = 0;
    const [f, r] = [burning.forward, burning.right];
    const dn: Vec3 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    FIRE_PLACES.forEach((place, i) => {
      if (!(burning.burning & (1 << i))) return;
      const fire = fires[i];
      for (let k = 0; k < 3; k += 1) fire.at[k] = f[k] * place.at[0] + r[k] * place.at[1] + dn[k] * place.at[2];
      fire.size = place.size;
      fire.strength = burning.strength;
      fire.born = burning.fireBorn;
      effect.fires.push(fire);
    });
    effect.blasts.length = 0;
    if (burning.blast) {
      const blast = blastList[slot][0];
      const jitter = (burning.blast.seed / 255 - 0.5) * 2;
      blast.at[0] = jitter;
      blast.at[1] = -jitter;
      blast.at[2] = 1;
      blast.size = burning.blast.size;
      blast.born = burning.blast.born;
      effect.blasts.push(blast);
    }
    effect.air[0] = -burning.velocity[0];
    effect.air[1] = -burning.velocity[1];
    effect.air[2] = -burning.velocity[2];
    const out = slotSprites[slot];
    const count = effectSprites(effect, out);
    for (let i = 0; i < count; i += 1) {
      out[i * SPRITE_FLOATS] += burning.north;
      out[i * SPRITE_FLOATS + 1] += burning.east;
      out[i * SPRITE_FLOATS + 2] += burning.down;
    }
    return count;
  }

  return {
    draw(context) {
      const started = performance.now();
      const sight = source.sight();
      drawn.models = drawn.silhouettes = drawn.lights = drawn.trailSegments = drawn.burning = drawn.drawCalls = 0;
      for (const label of shared.labels) label.shown = false;
      if (!sight) return;
      if (gl !== context) setUp(context);
      const now = source.now();
      const seconds = now / 1000;
      traffic.advance(now, gone);
      const list = traffic.list;
      const count = list.length;
      grow(count);
      if (!sky) sky = new Sky(sight.lon, sight.lat);
      sky.follow(sight.lon, sight.lat);
      origin[0] = sky.east(sight.lon);
      origin[1] = sky.north(sight.lat);
      origin[2] = sky.up(sight.altitude);
      const fog = sight.cloud / CLOUD_SEEN_M + sight.rain / RAIN_SEEN_M;
      const warmer = warmerThanStandard(sight.temperature, sight.altitude);
      const budget = budgetFor(sight.quality, sight.handheld);

      // Where each is from the eye's aircraft, and how far.
      for (let i = 0; i < count; i += 1) {
        const { shown } = list[i];
        const n = sky.north(shown.lat) - origin[1];
        const e = sky.east(shown.lon) - origin[0];
        const d = origin[2] - sky.up(shown.altitude);
        north[i] = n;
        east[i] = e;
        down[i] = d;
        const far = Math.hypot(n, e, d);
        const hidden = shown.opacity <= 0.01 || ((shown.flags & ON_GROUND) !== 0 && far > GROUND_SEEN_M) || Math.exp(-fog * far) < 0.02;
        distance[i] = hidden ? Infinity : far;
      }
      choose(distance, count, budget, kinds, order);

      // The world's north, east and down to the camera's: the aircraft's frame (its attitude) taken to the camera (its model-view).
      worldViewOf(sight, worldView);
      const aspect = context.drawingBufferWidth / Math.max(context.drawingBufferHeight, 1);
      modelProjection.set(perspective(sight.fov, aspect, ...MODEL_RANGE));
      silhouetteProjection.set(perspective(sight.fov, aspect, ...SILHOUETTE_RANGE));
      farProjection.set(perspective(sight.fov, aspect, ...FAR_RANGE));
      const pixelAngle = (2 * Math.tan((sight.fov * Math.PI) / 360)) / Math.max(context.drawingBufferHeight, 1);

      // Instances, lights, contrails, fires and labels, the nearest first.
      let modelCount = 0;
      let silhouetteCount = 0;
      let lightCount = 0;
      let segmentCount = 0;
      let burningCount = 0;
      let labelCount = 0;
      const segmentsMost = budget.trailSegments;
      if (segments.length < segmentsMost * SEGMENT_FLOATS) segments = new Float32Array(segmentsMost * SEGMENT_FLOATS);
      const burningMost = Math.min(BURNING_MOST, budget.burning);
      for (let k = 0; k < count; k += 1) {
        const i = order[k];
        const aircraft = list[i];
        const { shown, look } = aircraft;
        const kind = kinds[i];
        const far = distance[i];
        const kept = keptOf(aircraft);
        const airborne = (shown.flags & ON_GROUND) === 0;
        // The contrail is laid whether or not it is drawn: it is where the aircraft has been.
        const strength = airborne ? contrailStrength(shown.altitude, warmer) : 0;
        kept.trail.follow(shown.lon, shown.lat, shown.altitude, strength, seconds, sky);
        if (!(far < Infinity)) continue;
        const seen = shown.opacity * Math.exp(-fog * far);
        const own = (aircraft.id * 0.137) % 1;
        if (kind === AS_MODEL || kind === AS_SILHOUETTE) {
          const out = kind === AS_MODEL ? models : silhouettes;
          const at = (kind === AS_MODEL ? modelCount++ : silhouetteCount++) * INSTANCE_FLOATS;
          out[at] = north[i];
          out[at + 1] = east[i];
          out[at + 2] = down[i];
          writeAxes(shown.heading, shown.pitch, shown.roll, out, at + 3);
          // The silhouettes fade out as the lights fade in.
          out[at + 9] = kind === AS_SILHOUETTE ? seen * (1 - smooth((far - SILHOUETTE_M * 0.85) / (SILHOUETTE_M * 0.15))) : seen;
          out[at + 10] = shown.flags & GEAR_DOWN ? 1 : 0;
          out[at + 11] = own;
        }
        if (kind === AS_LIGHT || (kind === AS_SILHOUETTE && far > LIGHT_FROM_M)) {
          const at = lightCount++ * LIGHT_FLOATS;
          lights[at] = north[i];
          lights[at + 1] = east[i];
          lights[at + 2] = down[i];
          // Fading in over the silhouette it takes over from; at once where it is in place of one the budget had no room for.
          const fadeIn = kind === AS_SILHOUETTE ? smooth((far - LIGHT_FROM_M) / (SILHOUETTE_M - LIGHT_FROM_M)) : 1;
          lights[at + 3] = seen * fadeIn * (1 - smooth((far - 300_000) / 100_000));
          lights[at + 4] = own;
        }
        if (strength > 0.01 || kept.trail.count > 1) {
          head[0] = north[i];
          head[1] = east[i];
          head[2] = down[i];
          segmentCount += kept.trail.write(segments, segmentCount, segmentsMost - segmentCount, sky, origin, head, strength * seen, seconds);
        }
        if ((look.burning || look.blast) && far < BURNING_M && burningCount < burningMost) {
          writeBurning(burningNow[burningCount], aircraft, kept, north[i], east[i], down[i], seconds);
          burningCount += 1;
        } else if (!look.burning && !look.blast) {
          kept.fireBorn = null;
        }
        // From the seat, none over the panel or the roof: only where the aircraft is seen through a window.
        if (labelCount < shared.labels.length && far < LABEL_M && sight.view !== "clean" && aircraft.callsign
          && (sight.view !== "cockpit" || throughWindows(inAircraft(sight.attitude, [north[i], east[i], down[i]])))) {
          const label = shared.labels[labelCount];
          if (screenOf(worldView, modelProjection, north[i], east[i], down[i] - 25, label)) {
            label.shown = true;
            label.distance = far;
            label.callsign = aircraft.callsign;
            labelCount += 1;
          }
        }
      }

      // Set the picture up as the flight's own aircraft does: the whole of it, blended, with a depth of its own.
      context.viewport(0, 0, context.drawingBufferWidth, context.drawingBufferHeight);
      context.disable(context.SCISSOR_TEST);
      context.disable(context.STENCIL_TEST);
      context.disable(context.CULL_FACE);
      context.colorMask(true, true, true, true);
      context.enable(context.BLEND);
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
      context.disable(context.DEPTH_TEST);
      context.depthMask(false);
      const p = programs!;

      if (lightCount) {
        context.useProgram(p.light);
        context.uniformMatrix4fv(uniform(p.light, "uWorldView"), false, worldView);
        context.uniformMatrix4fv(uniform(p.light, "uProjection"), false, farProjection);
        context.uniform1f(uniform(p.light, "uTime"), seconds % 1000);
        context.uniform1f(uniform(p.light, "uPixel"), Math.max(1, context.drawingBufferHeight / 720));
        upload(context, lightGl!, lights, lightCount, LIGHT_FLOATS);
        context.bindVertexArray(lightGl!.vao);
        context.drawArrays(context.POINTS, 0, lightCount);
        drawn.drawCalls += 1;
      }
      if (segmentCount) {
        context.useProgram(p.trail);
        context.uniformMatrix4fv(uniform(p.trail, "uWorldView"), false, worldView);
        context.uniformMatrix4fv(uniform(p.trail, "uProjection"), false, farProjection);
        context.uniform1f(uniform(p.trail, "uPixelAngle"), pixelAngle);
        context.uniform1f(uniform(p.trail, "uLasts"), TRAIL_S);
        const day = 0.55 + 0.45 * Math.min(Math.max(sight.daylight, 0), 1);
        context.uniform3f(uniform(p.trail, "uColour"), 0.95 * day, 0.96 * day, 0.98 * day);
        upload(context, trailGl!, segments, segmentCount, SEGMENT_FLOATS);
        context.bindVertexArray(trailGl!.vao);
        context.drawArraysInstanced(context.TRIANGLE_STRIP, 0, 4, segmentCount);
        drawn.drawCalls += 1;
      }
      if (silhouetteCount || modelCount) {
        context.useProgram(p.model);
        context.uniformMatrix4fv(uniform(p.model, "uWorldView"), false, worldView);
        context.uniform3f(uniform(p.model, "uExtent"), ...model.extent);
        context.uniform3f(uniform(p.model, "uSun"), ...sight.sun);
        const [ambient, lit, away] = skyLighting(OUTSIDE_LIGHTING, sight.sunlight, sight.daylight);
        context.uniform3f(uniform(p.model, "uLighting"), ambient, lit, away);
        context.enable(context.DEPTH_TEST);
        context.depthFunc(context.LESS);
        context.depthMask(true);
        for (const [mesh, data, instances, projection] of [
          [meshes!.silhouette, silhouettes, silhouetteCount, silhouetteProjection],
          [meshes!.model, models, modelCount, modelProjection],
        ] as const) {
          if (!instances) continue;
          context.clearDepth(1);
          context.clear(context.DEPTH_BUFFER_BIT);
          context.uniformMatrix4fv(uniform(p.model, "uProjection"), false, projection);
          upload(context, mesh, data, instances, INSTANCE_FLOATS);
          context.bindVertexArray(mesh.vao);
          context.drawElementsInstanced(context.TRIANGLES, mesh.count, context.UNSIGNED_SHORT, 0, instances);
          drawn.drawCalls += 1;
        }
        context.depthMask(false);
      }

      // What burns: the nearest few, and those forgotten that still do.
      let spriteCount = 0;
      let slot = 0;
      for (let b = 0; b < burningCount && slot < BURNING_MOST; b += 1) spriteCount = pack(spriteCount, slot++, burningNow[b], seconds);
      for (let l = lingering.length - 1; l >= 0; l -= 1) {
        const linger = lingering[l];
        if (seconds > linger.until) {
          lingering.splice(l, 1);
          continue;
        }
        if (slot >= BURNING_MOST) continue;
        linger.state.north = sky.north(linger.lat) - origin[1];
        linger.state.east = sky.east(linger.lon) - origin[0];
        linger.state.down = origin[2] - sky.up(linger.altitude);
        spriteCount = pack(spriteCount, slot++, linger.state, seconds);
      }
      if (spriteCount) {
        effects ??= makeEffectsPass(context, (vertex, fragment) => compile(context, vertex, fragment));
        effects.drawSprites(sprites, spriteCount, worldView, farProjection, sight.sun, [4, 20], false);
        drawn.drawCalls += 1;
      }

      context.bindVertexArray(null);
      context.bindBuffer(context.ARRAY_BUFFER, null);
      context.disable(context.BLEND);
      drawn.models = modelCount;
      drawn.silhouettes = silhouetteCount;
      drawn.lights = lightCount;
      drawn.trailSegments = segmentCount;
      drawn.burning = slot;
      drawn.cpuMs = performance.now() - started;
    },

    dispose() {
      const context = gl;
      gl = null;
      if (!context) return;
      for (const program of Object.values(programs ?? {})) context.deleteProgram(program);
      for (const mesh of Object.values(meshes ?? {})) {
        context.deleteVertexArray(mesh.vao);
        for (const buffer of [mesh.vertices, mesh.indices, mesh.instances]) context.deleteBuffer(buffer);
      }
      for (const stream of [lightGl, trailGl]) {
        if (!stream) continue;
        context.deleteVertexArray(stream.vao);
        context.deleteBuffer(stream.buffer);
      }
      effects?.dispose();
      programs = null;
      meshes = null;
      lightGl = trailGl = null;
      effects = null;
    },
  };

  /** A burning aircraft's sprites laid after `from` (they were made in its slot, which may not follow on): how many there are now. */
  function pack(from: number, slot: number, burning: Burning, now: number): number {
    const made = spritesOf(slot, burning, now);
    const start = slotSprites[slot].byteOffset / 4;
    if (start !== from * SPRITE_FLOATS) sprites.copyWithin(from * SPRITE_FLOATS, start, start + made * SPRITE_FLOATS);
    return from + made;
  }
}

const smooth = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

const RADIANS = Math.PI / 180;

/** An aircraft's forward and right in the world's north, east and down (view.ts's `rotation`, its first two columns), into `out` at `at`. */
function writeAxes(heading: number, pitch: number, roll: number, out: Float32Array | number[], at: number): void {
  const [ch, sh] = [Math.cos(heading * RADIANS), Math.sin(heading * RADIANS)];
  const [cp, sp] = [Math.cos(pitch * RADIANS), Math.sin(pitch * RADIANS)];
  const [cr, sr] = [Math.cos(roll * RADIANS), Math.sin(roll * RADIANS)];
  out[at] = ch * cp;
  out[at + 1] = sh * cp;
  out[at + 2] = -sp;
  out[at + 3] = ch * sp * sr - sh * cr;
  out[at + 4] = sh * sp * sr + ch * cr;
  out[at + 5] = cp * sr;
}

const both = [0, 0, 0, 0, 0, 0];
function axesOf(heading: number, pitch: number, roll: number, forward: Vec3, right: Vec3): void {
  writeAxes(heading, pitch, roll, both, 0);
  forward[0] = both[0];
  forward[1] = both[1];
  forward[2] = both[2];
  right[0] = both[3];
  right[1] = both[4];
  right[2] = both[5];
}

/**
 * The world's north, east and down from the eye's aircraft to the camera:
 * its model-view after the turn from the world into its own frame.
 */
const turned = new Float64Array(16);
export function worldViewOf(sight: Pick<Sight, "attitude" | "modelView">, out: Float32Array): Float32Array {
  const { heading, pitch, roll } = sight.attitude;
  const [ch, sh] = [Math.cos(heading * RADIANS), Math.sin(heading * RADIANS)];
  const [cp, sp] = [Math.cos(pitch * RADIANS), Math.sin(pitch * RADIANS)];
  const [cr, sr] = [Math.cos(roll * RADIANS), Math.sin(roll * RADIANS)];
  // view.ts's rotation, rows: the aircraft's frame to the world's.
  const r00 = ch * cp, r01 = ch * sp * sr - sh * cr, r02 = ch * sp * cr + sh * sr;
  const r10 = sh * cp, r11 = sh * sp * sr + ch * cr, r12 = sh * sp * cr - ch * sr;
  const r20 = -sp, r21 = cp * sr, r22 = cp * cr;
  // Its transpose as a 4x4, columns first: column c is row c of the rotation.
  const a = turned;
  a[0] = r00; a[1] = r01; a[2] = r02; a[4] = r10; a[5] = r11; a[6] = r12; a[8] = r20; a[9] = r21; a[10] = r22; a[15] = 1;
  const m = sight.modelView;
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = m[r] * a[c * 4] + m[4 + r] * a[c * 4 + 1] + m[8 + r] * a[c * 4 + 2] + m[12 + r] * a[c * 4 + 3];
    }
  }
  return out;
}

/** Where a point north, east and down of the eye's aircraft is on the picture (0 to 1), into `out`; false where it is behind the eye or off it. */
function screenOf(worldView: Float32Array, projection: Float32Array, n: number, e: number, d: number, out: { x: number; y: number }): boolean {
  const x = worldView[0] * n + worldView[4] * e + worldView[8] * d + worldView[12];
  const y = worldView[1] * n + worldView[5] * e + worldView[9] * d + worldView[13];
  const z = worldView[2] * n + worldView[6] * e + worldView[10] * d + worldView[14];
  const cx = projection[0] * x + projection[8] * z;
  const cy = projection[5] * y + projection[9] * z;
  const w = -z;
  if (w <= 1) return false;
  out.x = 0.5 + (0.5 * cx) / w;
  out.y = 0.5 - (0.5 * cy) / w;
  return out.x > -0.05 && out.x < 1.05 && out.y > -0.05 && out.y < 1.05;
}
