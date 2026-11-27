/**
 * What burns and bursts on an aircraft that has come to grief: fires with
 * their smoke, and blasts with their fireballs and what they throw.
 *
 * All of it is sprites: soft discs that face the eye, each a puff of flame
 * or smoke, a glow, or a glowing fragment, with its grain made in the
 * shader (no pictures are fetched). Where each is follows from the fire or
 * the blast it is of and the time since that began, and from nothing else
 * (`effectSprites`): the same moment always draws the same, and nothing is
 * remembered between frames. A fire is a handful of flames that live half a
 * second each, over and over, and a train of smoke puffs the air carries
 * off; a blast is a flash, a ball of lobes that swells, cools from white
 * through orange to soot and drifts up, and fragments on the paths of
 * things thrown.
 *
 * The sprites are drawn after the aircraft, into the same picture with the
 * same lens, sorted from the farthest to the nearest and hidden by the
 * aircraft where it is nearer (aircraftRenderer.ts). A flame gives light
 * rather than hiding what is behind it, and smoke hides it: one blend does
 * both, each sprite saying how much of it is which.
 */
import type { AircraftEffects } from "./aircraftRenderer";

type Vec3 = [number, number, number];

/** A sprite's numbers, as the GPU is handed them: see `effectSprites`. */
export const SPRITE_FLOATS = 12;
/** No more are drawn than this, however much burns. */
export const MAX_SPRITES = 480;

const FLAMES = 7;
const FLAME_S = 0.55;
const SMOKE_PUFFS = 26;
const SMOKE_S = 5.5;
const LOBES = 8;
const FRAGMENTS = 12;
/** How long a blast is seen, and its fragments; seconds. */
export const BLAST_S = 8;
const FRAGMENT_S = 3.2;
/** How long a blast takes to swell: 95% of its size at three times this, seconds. */
const SWELL_S = 0.13;
/** How long its flash lasts, seconds; and how large across one has to be, metres, to light the aircraft with all of it. */
const FLASH_S = 0.3;
const GLARE_FULL_M = 15;
const GRAVITY = 9.81;

const clamp = (value: number, low = 0, high = 1) => Math.min(Math.max(value, low), high);
const smooth = (t: number) => { const c = clamp(t); return c * c * (3 - 2 * c); };
/** A number from 0 to 1 that is always the same for the same `n`, and unlike its neighbours'. */
const chance = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * How far something light has gone after `age` seconds in air moving at
 * 1 m/s past where it began, having started still there and taken `lag`
 * seconds to be caught up: metres per m/s of the air.
 */
const carried = (age: number, lag: number) => age - lag * (1 - Math.exp(-age / lag));

/** How much of its full size a blast has swollen to, `age` seconds after it began: 0 to 1. */
export const blastSwell = (age: number) => (age <= 0 ? 0 : 1 - Math.exp(-age / SWELL_S));

/**
 * How hot a blast's ball is, `age` seconds on: 2 white, 1 orange, 0 soot.
 * White for its first third of a second, then cooling to smoke by a little
 * over two.
 */
export function blastHeat(age: number): number {
  if (age < 0.35) return 2 - 0.9 * (age / 0.35);
  return 1.1 * (1 - clamp((age - 0.35) / 1.8)) ** 1.5;
}

/**
 * How brightly the blasts light what is round them at this moment, 0 to 1:
 * each for its flash's length, a small one (a surface torn off) only
 * dimly; not at all where the effects are to be calm.
 */
export function blastGlare(effects: AircraftEffects): number {
  if (effects.calm) return 0;
  let glare = 0;
  for (const { born, size } of effects.blasts) {
    const age = effects.time - born;
    if (age >= 0 && age < FLASH_S) glare = Math.max(glare, (1 - age / FLASH_S) ** 2 * Math.min(1, size / GLARE_FULL_M));
  }
  return glare;
}

/**
 * Every sprite of `effects` at its own moment, written into `out`,
 * `SPRITE_FLOATS` each; how many, as the answer. A sprite: where its middle
 * is (three, in the effects' frame), its radius, half of how far it is
 * drawn out and which way (three: smoke in a wind is a streak), how hot
 * (0 soot, 1 orange flame, 2 white), how thick (0 to 1), a number of its
 * own for its grain, how grainy (0 a plain glow, 1 billowing), and how far
 * it is drawn towards the eye, in radii (a flame on a wing is seen on it,
 * not half sunk into it).
 */
export function effectSprites(effects: AircraftEffects, out: Float32Array): number {
  // Nothing is made anew here: it is drawn every frame, for every aircraft that burns.
  const { time, air, up } = effects;
  const wind = Math.hypot(air[0], air[1], air[2]);
  const dx = wind > 1e-6 ? air[0] / wind : 0;
  const dy = wind > 1e-6 ? air[1] / wind : 0;
  const dz = wind > 1e-6 ? air[2] / wind : 0;
  writing = out;
  room = Math.min(MAX_SPRITES, Math.floor(out.length / SPRITE_FLOATS));
  count = 0;

  for (let number = 0; number < effects.fires.length; number++) {
    const { at, size, strength: asked, born } = effects.fires[number];
    const age = time - born;
    const strength = clamp(asked);
    if (age < 0 || strength <= 0 || !(size > 0)) continue;
    const own = born * 13.7 + at[0] * 3.1 + at[1] * 5.3 + at[2] * 7.9 + number * 1.9;
    // A flame stands up in still air and is laid back by a wind, no further than a few of its own lengths.
    const laid = Math.min(wind * 0.12, size * 3);
    const fx = up[0] * size * 1.1 + dx * laid;
    const fy = up[1] * size * 1.1 + dy * laid;
    const fz = up[2] * size * 1.1 + dz * laid;
    const length = Math.hypot(fx, fy, fz) || 1;

    const flicker = 0.8 + 0.2 * chance(own + Math.floor(time * 14));
    put(at[0] + fx * 0.2, at[1] + fy * 0.2, at[2] + fz * 0.2, size * 1.6, 0, 0, 0, 1, 0.2 * strength * flicker, chance(own), 0, 0.6);
    for (let j = 0; j < FLAMES; j++) {
      const turn = age / FLAME_S + j / FLAMES;
      const phase = turn - Math.floor(turn);
      // Not one from before the fire began.
      if (phase * FLAME_S > age) continue;
      const seed = chance(own + j * 17.3 + Math.floor(turn) * 3.7);
      const reach = phase * (0.7 + 0.6 * seed);
      const radius = size * (0.55 - 0.3 * phase) * (0.7 + 0.3 * strength);
      put(
        at[0] + flameJitter(seed, 0, size) + fx * reach, at[1] + flameJitter(seed, 1, size) + fy * reach, at[2] + flameJitter(seed, 2, size) + fz * reach,
        radius, (fx / length) * radius * 0.6, (fy / length) * radius * 0.6, (fz / length) * radius * 0.6,
        1.45 - 0.8 * phase, 0.9 * strength * smooth(phase / 0.15) * (1 - phase) ** 0.8, seed, 1, 0.6,
      );
    }

    // Smoke rises faster off a larger fire, and spreads as it goes: thinner for it.
    const rise = 2.2 + 1.1 * Math.sqrt(size);
    const spread = 0.9 + 0.35 * size;
    for (let j = 0; j < SMOKE_PUFFS; j++) {
      const turn = age / SMOKE_S + j / SMOKE_PUFFS;
      const phase = turn - Math.floor(turn);
      const old = phase * SMOKE_S;
      if (old > age) continue;
      const seed = chance(own + 51.1 + j * 7.9 + Math.floor(turn) * 2.3);
      const along = carried(old, 0.25);
      const radius = size * 0.4 + spread * old ** 0.7;
      // Nearly all the way to the next puff, along the wind: the puffs of a fast trail run into one streak.
      const drawn = wind * (SMOKE_S / SMOKE_PUFFS) * 0.9 * (1 - Math.exp(-old / 0.25));
      put(
        at[0] + fx * 0.6 + up[0] * rise * old + air[0] * along + wander(seed, 0, size, old),
        at[1] + fy * 0.6 + up[1] * rise * old + air[1] * along + wander(seed, 1, size, old),
        at[2] + fz * 0.6 + up[2] * rise * old + air[2] * along + wander(seed, 2, size, old),
        radius, dx * drawn, dy * drawn, dz * drawn,
        Math.max(0, 0.9 - old / 0.35),
        strength * smooth(old / 0.2) * (1 - phase) ** 1.2 * Math.max((size * 0.4) / radius, 0.25) ** 0.45,
        seed, 1, 0.2,
      );
    }
  }

  for (let number = 0; number < effects.blasts.length; number++) {
    const { at, size, born } = effects.blasts[number];
    const age = time - born;
    if (age < 0 || age > BLAST_S || !(size > 0)) continue;
    const own = born * 7.3 + at[0] * 2.9 + at[1] * 4.7 + at[2] * 6.1 + number * 3.3;
    const swell = blastSwell(age);
    // Swollen to its size in under half a second; then the smoke it has become goes on spreading slowly, and thins.
    const radius = (size / 2) * swell * (1 + 0.12 * age);
    const lifted = (size * 0.3 * age) / (1 + 0.15 * age);
    const drift = carried(age, 0.6);
    const mx = at[0] + up[0] * lifted + air[0] * drift;
    const my = at[1] + up[1] * lifted + air[1] * drift;
    const mz = at[2] + up[2] * lifted + air[2] * drift;
    const heat = blastHeat(age);
    const fade = age < 3 ? 1 : 1 - (age - 3) / (BLAST_S - 3);

    if (age < FLASH_S && !effects.calm) {
      put(at[0], at[1], at[2], size * (0.9 + 3.5 * age), 0, 0, 0, 2, 0.6 * (1 - age / FLASH_S) ** 2, chance(own), 0, 1);
    }
    if (age < 0.6) put(mx, my, mz, radius * 0.9, 0, 0, 0, 2, 1 - age / 0.6, chance(own + 1), 0.3, 0.5);
    for (let j = 0; j < LOBES; j++) {
      const seed = chance(own + 9.1 + j * 5.7);
      const out3 = direction(seed * 71.3 + j);
      const from = radius * 0.5;
      put(
        mx + out3[0] * from, my + out3[1] * from, mz + out3[2] * from, radius * (0.62 + 0.25 * seed), 0, 0, 0,
        heat * (0.8 + 0.4 * seed), (0.75 + 0.15 * Math.min(heat, 1)) * fade ** 1.5, seed, 1, 0,
      );
    }
    if (age < FRAGMENT_S) {
      // What is thrown slows in the air as it goes, and falls.
      const flown = (1 - Math.exp(-age * 0.6)) / 0.6;
      const slowed = Math.exp(-age * 0.6);
      const fallen = 0.5 * GRAVITY * age * age;
      const windward = carried(age, 1.5);
      for (let j = 0; j < FRAGMENTS; j++) {
        const seed = chance(own + 23.9 + j * 11.3);
        const thrown = direction(seed * 43.1 + j * 1.7);
        // More up than down: what goes down is stopped by what it came from.
        const ax = thrown[0] + up[0] * 0.6;
        const ay = thrown[1] + up[1] * 0.6;
        const az = thrown[2] + up[2] * 0.6;
        const speed = ((9 + 16 * seed) * Math.sqrt(size / 6)) / (Math.hypot(ax, ay, az) || 1);
        put(
          at[0] + ax * speed * flown - up[0] * fallen + air[0] * windward,
          at[1] + ay * speed * flown - up[1] * fallen + air[1] * windward,
          at[2] + az * speed * flown - up[2] * fallen + air[2] * windward,
          size * 0.016 * (0.6 + chance(seed * 3.3)),
          // Drawn out along its path, as a spark is seen.
          (ax * speed * slowed - up[0] * GRAVITY * age) * 0.05,
          (ay * speed * slowed - up[1] * GRAVITY * age) * 0.05,
          (az * speed * slowed - up[2] * GRAVITY * age) * 0.05,
          2 - 0.4 * age, (1 - age / FRAGMENT_S) ** 0.7, seed, 0, 0.5,
        );
      }
    }
  }
  return count;
}

/** Where `effectSprites` writes its sprites, how many fit, and how many it has written: kept here, so that `put` is made once. */
let writing: Float32Array = new Float32Array(0);
let room = 0;
let count = 0;

function put(
  x: number, y: number, z: number, radius: number, sx: number, sy: number, sz: number,
  heat: number, opacity: number, seed: number, grain: number, lift: number,
): void {
  if (count >= room || !(opacity > 0.004) || !(radius > 0)) return;
  const out = writing;
  const at = count * SPRITE_FLOATS;
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  out[at + 3] = radius;
  out[at + 4] = sx;
  out[at + 5] = sy;
  out[at + 6] = sz;
  out[at + 7] = heat;
  out[at + 8] = Math.min(opacity, 1);
  out[at + 9] = seed;
  out[at + 10] = grain;
  out[at + 11] = lift;
  count++;
}

/** How far a flame is from where its fire is, one way, metres. */
const flameJitter = (seed: number, k: number, size: number) => (chance(seed * 91.7 + k * 13.1) - 0.5) * size * 0.7;
/** How far a puff of smoke has wandered off its train, one way, metres. */
const wander = (seed: number, k: number, size: number, old: number) => (chance(seed * 57.3 + k * 29.9) - 0.5) * (size * 0.3 + 0.6 * Math.sqrt(old));

/** A direction, evenly any: the same one for the same `n`. Written into the same three numbers each time. */
const directed: Vec3 = [0, 0, 0];
function direction(n: number): Readonly<Vec3> {
  const z = chance(n) * 2 - 1;
  const round = chance(n + 0.37) * Math.PI * 2;
  const flat = Math.sqrt(1 - z * z);
  directed[0] = flat * Math.cos(round);
  directed[1] = flat * Math.sin(round);
  directed[2] = z;
  return directed;
}

const VERTEX = `#version 300 es
layout(location = 0) in vec4 aPlace;
layout(location = 1) in vec4 aStretch;
layout(location = 2) in vec4 aLook;
uniform mat4 uModelView;
uniform mat4 uProjection;
// Nearer the eye than the first, a sprite is not drawn; from the second on, in full. Both further off for a larger one.
uniform vec2 uNear;
out vec2 vAt;
out vec2 vAcross;
out float vLong;
out float vHeat;
out float vOpacity;
out float vSeed;
out float vGrain;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec4 centre = uModelView * vec4(aPlace.xyz, 1.0);
  float radius = aPlace.w;
  // Drawn out along its stretch as the eye sees that; round, seen end on.
  vec2 along = (uModelView * vec4(aStretch.xyz, 0.0)).xy;
  float reach = length(along);
  vec2 axis = reach > 1e-4 ? along / reach : vec2(1.0, 0.0);
  vec2 offset = axis * corner.x * (radius + reach) + vec2(-axis.y, axis.x) * corner.y * radius;
  float away = length(centre.xyz);
  vec3 at = centre.xyz + vec3(offset, 0.0) - (centre.xyz / max(away, 1e-4)) * min(aLook.w * radius, away * 0.5);
  gl_Position = uProjection * vec4(at, 1.0);
  vAt = corner;
  vAcross = axis * corner.x + vec2(-axis.y, axis.x) * corner.y;
  vLong = (radius + reach) / radius;
  vHeat = aStretch.w;
  // Thinner the further the eye is inside it: smoke one stands in is a haze, not a wall.
  vOpacity = aLook.x * smoothstep(uNear.x + 0.4 * radius, uNear.y + 1.2 * radius, away);
  vSeed = aLook.y;
  vGrain = aLook.z;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
in vec2 vAcross;
in float vLong;
in float vHeat;
in float vOpacity;
in float vSeed;
in float vGrain;
// Towards the sun, as the eye sees it: smoke is lit on that side.
uniform vec2 uSun;
out vec4 colour;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float body = 1.0 - length(vAt);
  if (body <= 0.0 || vOpacity <= 0.0) discard;
  // The grain as round on a sprite drawn out as on a round one.
  vec2 q = vec2(vAt.x * vLong, vAt.y);
  float grain = noise(q * 2.3 + vSeed * 37.0) * 0.65 + noise(q * 5.1 - vSeed * 11.0) * 0.35;
  // Billows eat into the edge; a plain glow just falls away.
  float density = smoothstep(0.0, 0.6, body + vGrain * (grain - 0.62) * 0.9) * smoothstep(0.0, 0.12, body);
  float alpha = density * vOpacity;
  // Hotter in the thick of it, and patchy: the cooler patches are the first to turn to soot.
  float heat = vHeat * mix(1.0, 0.45 + 0.75 * grain + 0.35 * body, vGrain);
  vec3 fire = mix(vec3(0.9, 0.22, 0.03), vec3(1.0, 0.62, 0.14), smoothstep(0.5, 1.2, heat));
  fire = mix(fire, vec3(1.0, 0.95, 0.8), smoothstep(1.2, 2.0, heat));
  float glow = smoothstep(0.3, 0.9, heat);
  vec3 smoke = mix(vec3(0.03, 0.027, 0.025), vec3(0.17, 0.16, 0.155), grain * body) * (0.8 + 0.45 * dot(vAcross, uSun));
  // Flame is light added to what is behind it; smoke covers it.
  colour = vec4(mix(smoke, fire * (0.7 + 0.6 * body), glow) * alpha, alpha * (1.0 - 0.75 * glow));
}`;

/** What draws the effects into one WebGL picture. */
export interface EffectsPass {
  /**
   * Draw `effects` as `modelView` and `projection` see them (4x4s, columns
   * first), over what is in the picture and behind whatever is nearer in
   * its depth. `light` is towards the sun, in the effects' frame; `near`
   * the distances from the eye, metres, between which a small sprite
   * fades in.
   * Leaves the blend on, the depth read and not written.
   */
  draw(effects: AircraftEffects, modelView: ArrayLike<number>, projection: ArrayLike<number>, light: Vec3, near: [number, number]): void;
  /**
   * Draw `count` sprites made already (`effectSprites`'s, `SPRITE_FLOATS`
   * each, in `sprites`), as `draw` does; tested against the depth there, or
   * over everything where `depth` is false.
   */
  drawSprites(
    sprites: Float32Array, count: number, modelView: ArrayLike<number>, projection: ArrayLike<number>, light: Vec3, near: [number, number], depth?: boolean,
  ): void;
  dispose(): void;
}

export function makeEffectsPass(gl: WebGL2RenderingContext, compile: (vertex: string, fragment: string) => WebGLProgram): EffectsPass {
  const program = compile(VERTEX, FRAGMENT);
  const uniforms = Object.fromEntries(
    ["uModelView", "uProjection", "uNear", "uSun"].map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  const vao = gl.createVertexArray()!;
  const buffer = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_SPRITES * SPRITE_FLOATS * 4, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, SPRITE_FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const sprites = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);
  const sorted = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);
  const depth = new Float32Array(MAX_SPRITES);
  const order = new Uint16Array(MAX_SPRITES);
  /** The first so many of `order`, each made once; and the farther of two first. */
  const firsts: Uint16Array[] = [];
  const farther = (a: number, b: number) => depth[a] - depth[b];
  const modelViewIn = new Float32Array(16);
  const projectionIn = new Float32Array(16);

  function drawSprites(
    sprites: Float32Array, made: number, modelView: ArrayLike<number>, projection: ArrayLike<number>, light: Vec3, near: [number, number], tested = true,
  ): void {
    const count = Math.min(made, MAX_SPRITES);
    if (!count) return;
    // The farthest first: smoke covers what is behind it, and has to be laid over it. Nothing made anew: drawn every frame.
    for (let i = 0; i < count; i++) {
      const at = i * SPRITE_FLOATS;
      depth[i] = modelView[2] * sprites[at] + modelView[6] * sprites[at + 1] + modelView[10] * sprites[at + 2] + modelView[14];
      order[i] = i;
    }
    (firsts[count] ??= order.subarray(0, count)).sort(farther);
    for (let i = 0; i < count; i++) {
      const from = order[i] * SPRITE_FLOATS;
      const to = i * SPRITE_FLOATS;
      for (let k = 0; k < SPRITE_FLOATS; k++) sorted[to + k] = sprites[from + k];
    }
    const sunX = modelView[0] * light[0] + modelView[4] * light[1] + modelView[8] * light[2];
    const sunY = modelView[1] * light[0] + modelView[5] * light[1] + modelView[9] * light[2];

    gl.useProgram(program);
    modelViewIn.set(modelView);
    projectionIn.set(projection);
    gl.uniformMatrix4fv(uniforms.uModelView, false, modelViewIn);
    gl.uniformMatrix4fv(uniforms.uProjection, false, projectionIn);
    gl.uniform2f(uniforms.uNear, near[0], near[1]);
    gl.uniform2f(uniforms.uSun, sunX, sunY);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sorted, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (tested) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  return {
    draw(effects, modelView, projection, light, near) {
      drawSprites(sprites, effectSprites(effects, sprites), modelView, projection, light, near);
    },

    drawSprites,

    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
