/**
 * The weather a flight is in, as it goes past the eye: rain and hail in
 * streaks, ice crystals, shreds of cloud, a lightning bolt. (What is on the
 * glass, ice built up there too, is the aircraft's renderer's: on the
 * windows themselves.)
 *
 * And behind the engines, where the air is cold enough to freeze their
 * exhaust, a condensation trail each.
 *
 * And the cloud itself, round the eye: a veil over the world, which the
 * rain and the shreds go past in front of.
 *
 * Drawn into the 3D map's picture over the world and under the aircraft
 * (aircraftLayer.ts), so from the cockpit it is seen through the windows and
 * hidden by the panel, as the weather outside is. From outside, what goes
 * past is drawn after the aircraft instead (`drawNear`), in front of it
 * where it is nearer and hidden by it where it is not, with shreds of cloud
 * streaming between the eye and the aircraft: in cloud it is flown through
 * the cloud, not in a clear bubble of its own. Like the aircraft, it is
 * not in the map's coordinates: everything is metres in the aircraft's own
 * frame (forward, right, down), taken straight to the camera.
 *
 * Nothing here remembers a particle. Each has a home in a box round the eye,
 * made up from its number, and all of them are carried through the box, and
 * round it, by how far the air has gone past (`travel`); the box goes with
 * the eye. So ten thousand of them cost four uniforms a frame, and a change
 * of speed or of view moves none of them by a jump.
 */
import { perspective } from "../lib/studio/flight/view";
import type { Vec3 } from "../lib/studio/flight/view";

/** One kind of thing falling past: how many, how long and thick a streak, what colour. */
interface Fall {
  /** How many there are when there is as much of it as there can be. */
  count: number;
  /** The box round the eye they fill: metres forward, across and down. */
  box: Vec3;
  /** How long the eye holds a streak, seconds: its length is this times the air's speed, up to `longest` metres. */
  exposure: number;
  longest: number;
  /** Half a streak's width, metres; it is never drawn thinner than a pixel or so. */
  width: number;
  colour: Vec3;
  alpha: number;
  seed: number;
}

const RAIN: Fall = { count: 5200, box: [70, 44, 30], exposure: 1 / 110, longest: 2.4, width: 0.0025, colour: [0.78, 0.83, 0.9], alpha: 0.26, seed: 1 };
const HAIL: Fall = { count: 900, box: [50, 36, 26], exposure: 1 / 260, longest: 0.9, width: 0.008, colour: [1, 1, 1], alpha: 0.75, seed: 2 };
const ICE: Fall = { count: 3000, box: [60, 40, 30], exposure: 1 / 400, longest: 0.5, width: 0.0035, colour: [0.95, 0.97, 1], alpha: 0.42, seed: 3 };

/** Shreds of cloud: this many soft patches in a box this large, each this many metres across at most. */
const WISPS = { count: 56, box: [640, 360, 240] as Vec3, size: 110 };
/** And smaller ones, seen from outside, round the way from the eye to the aircraft: close enough to go past between them. */
const SHREDS = { count: 64, box: [170, 110, 70] as Vec3, size: 17 };

/** How long a condensation trail is drawn, metres: as far back as it reads as one from beside the aircraft. */
const TRAIL_M = 620;

/** A lightning bolt: where it runs, in the aircraft's frame, and how bright it is this frame, 0 to 1. */
export interface Bolt {
  points: Vec3[];
  brightness: number;
}

/** The weather to draw this frame. */
export interface WeatherView {
  /** The aircraft's frame to the camera's (see `Eye.modelView`), the lens, and where the eye is in that frame. */
  modelView: ArrayLike<number>;
  fov: number;
  eye: Vec3;
  /** How far the air has gone past the aircraft since the flight began, metres, in its frame; and which way it goes now, m/s. */
  travel: Vec3;
  air: Vec3;
  /** How much of each there is, 0 to 1. */
  rain: number;
  hail: number;
  ice: number;
  wisps: number;
  bolts: Bolt[];
  /** Seen from outside: what goes past nearer than the aircraft is drawn over it, by `drawNear`. */
  outside: boolean;
  /** Shreds of cloud going past between the eye and the aircraft, from outside, 0 to 1. */
  shreds: number;
  /** How far cloud round the eye hides the world, 0 to 1; and lightning on the glass, 0 to 1. */
  veil: number;
  flash: number;
  /** How light the sky is, 0 to 1 (lib/studio/flight/glass.ts): the cloud round the eye is a storm's grey, not white, where it is dark. All of it where not said. */
  sky?: number;
  /** Condensation trails: where each begins, in the aircraft's frame, and how much of one there is, 0 to 1. */
  trails: { from: Vec3[]; strength: number };
}

const STREAK_VERTEX = `#version 300 es
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform vec3 uEye;
uniform vec3 uBox;
uniform vec3 uTravel;
uniform vec3 uStreak;
uniform float uWidth;
uniform float uSeed;
out float vAcross;
out float vFade;
vec3 home(float n) {
  return fract(sin(vec3(n * 12.9898 + uSeed, n * 78.233 + uSeed * 1.7, n * 37.719 + uSeed * 2.3)) * 43758.5453);
}
void main() {
  int corner = gl_VertexID % 6;
  // Two triangles of a strip along the streak: its tail and its head, one side and the other.
  float along = (corner == 1 || corner == 2 || corner == 4) ? 1.0 : 0.0;
  float across = (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  vec3 place = fract(home(float(gl_VertexID / 6)) + uTravel / uBox) - 0.5;
  vec3 from = (uModelView * vec4(place * uBox + uEye, 1.0)).xyz;
  vec3 to = (uModelView * vec4(place * uBox + uEye + uStreak, 1.0)).xyz;
  vec3 at = mix(from, to, along);
  float far = max(-at.z, 0.0);
  // Across the streak and facing the eye; no thinner than about a pixel is at that distance.
  vec3 side = normalize(cross(to - from, at) + vec3(1e-6, 0.0, 0.0));
  at += side * across * max(uWidth, far * 0.00038);
  vec3 edge = abs(place) * 2.0;
  // Faded where it comes into the box and goes out of it, and right in front of the eye, where it would be a slab.
  vFade = (1.0 - smoothstep(0.72, 1.0, max(edge.x, max(edge.y, edge.z)))) * smoothstep(1.2, 4.5, far);
  vAcross = across;
  gl_Position = uProjection * vec4(at, 1.0);
}`;

const STREAK_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
in float vFade;
uniform vec4 uColour;
out vec4 colour;
void main() {
  float alpha = uColour.a * vFade * (1.0 - vAcross * vAcross);
  colour = vec4(uColour.rgb * alpha, alpha);
}`;

const WISP_VERTEX = `#version 300 es
uniform mat4 uModelView;
uniform mat4 uProjection;
// Where the box of them stands: round the eye, or between it and the aircraft.
uniform vec3 uCentre;
uniform vec3 uBox;
uniform vec3 uTravel;
uniform float uSize;
out vec2 vAt;
out float vFade;
vec3 home(float n) {
  return fract(sin(vec3(n * 91.17 + 4.1, n * 27.93 + 8.3, n * 53.71 + 1.9)) * 43758.5453);
}
void main() {
  int corner = gl_VertexID % 6;
  vec2 at = vec2((corner == 1 || corner == 2 || corner == 4) ? 1.0 : -1.0, (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0);
  float id = float(gl_VertexID / 6);
  vec3 seed = home(id);
  vec3 place = fract(seed + uTravel / uBox) - 0.5;
  vec3 centre = (uModelView * vec4(place * uBox + uCentre, 1.0)).xyz;
  float size = uSize * (0.45 + 0.55 * fract(seed.x * 7.3 + seed.y * 3.1));
  vec3 edge = abs(place) * 2.0;
  vFade = (1.0 - smoothstep(0.6, 1.0, max(edge.x, max(edge.y, edge.z)))) * smoothstep(size * 0.3, size * 1.2, -centre.z);
  vAt = at;
  gl_Position = uProjection * vec4(centre + vec3(at * size, 0.0), 1.0);
}`;

const WISP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
in float vFade;
uniform vec4 uColour;
out vec4 colour;
void main() {
  // A patch soft all the way to its edge, a little ragged.
  float r = dot(vAt, vAt);
  float ragged = 0.85 + 0.15 * sin(vAt.x * 9.0 + vAt.y * 7.0) * sin(vAt.y * 11.0 - vAt.x * 5.0);
  float alpha = uColour.a * vFade * exp(-r * 3.2) * ragged;
  colour = vec4(uColour.rgb * alpha, alpha);
}`;

/* A bolt is a line of points; each stretch between two is a strip, widened in
   the camera's frame so that it is as wide on the screen near as far. */
const BOLT_VERTEX = `#version 300 es
layout(location = 0) in vec3 aFrom;
layout(location = 1) in vec3 aTo;
layout(location = 2) in vec2 aCorner;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uWidth;
out float vAcross;
void main() {
  vec3 from = (uModelView * vec4(aFrom, 1.0)).xyz;
  vec3 to = (uModelView * vec4(aTo, 1.0)).xyz;
  vec3 at = mix(from, to, aCorner.x);
  vec3 side = normalize(cross(to - from, at) + vec3(1e-6, 0.0, 0.0));
  at += side * aCorner.y * uWidth * max(-at.z, 1.0);
  vAcross = aCorner.y;
  gl_Position = uProjection * vec4(at, 1.0);
}`;

const BOLT_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
uniform vec4 uColour;
out vec4 colour;
void main() {
  float core = 1.0 - abs(vAcross);
  colour = vec4(uColour.rgb, 1.0) * uColour.a * core * core;
}`;

/* A condensation trail: a ribbon back from an engine, a strip to each of its
   stretches, widening and thinning as the exhaust spreads into the air. */
const TRAIL_STRETCHES = 28;
const TRAIL_VERTEX = `#version 300 es
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform vec3 uFrom;
uniform float uLength;
uniform float uTime;
out float vAcross;
out float vAlong;
vec3 along(float s) {
  // Straight back, and a little unsteady the further it has drifted.
  float wander = s * s * 6.0;
  return uFrom + vec3(-uLength * s, sin(s * 9.0 + uTime * 0.7) * wander * 0.35, cos(s * 7.0 + uTime * 0.5) * wander * 0.25);
}
void main() {
  int corner = gl_VertexID % 6;
  float end = (corner == 1 || corner == 2 || corner == 4) ? 1.0 : 0.0;
  float across = (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  float s = (float(gl_VertexID / 6) + end) / float(${TRAIL_STRETCHES});
  vec3 here = (uModelView * vec4(along(s), 1.0)).xyz;
  vec3 next = (uModelView * vec4(along(s + 0.01), 1.0)).xyz;
  vec3 side = normalize(cross(next - here, here) + vec3(1e-6, 0.0, 0.0));
  vAcross = across;
  vAlong = s;
  gl_Position = uProjection * vec4(here + side * across * (0.6 + 5.0 * sqrt(s)), 1.0);
}`;

const TRAIL_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
in float vAlong;
uniform float uStrength;
out vec4 colour;
void main() {
  // Nothing right at the engine, where the exhaust has not yet frozen; then white, thinning away.
  float alpha = uStrength * 0.9 * smoothstep(0.02, 0.07, vAlong) * pow(max(1.0 - vAlong, 0.0), 1.2) * (1.0 - vAcross * vAcross);
  colour = vec4(vec3(0.97, 0.98, 1.0) * alpha, alpha);
}`;

/** One triangle over the whole picture. */
const FULL_VERTEX = `#version 300 es
out vec2 vAt;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vAt = corner * 2.0 - 1.0;
  gl_Position = vec4(vAt, 0.0, 1.0);
}`;

/** One colour over the whole picture: cloud round the eye, a flash. */
const WASH_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColour;
out vec4 colour;
void main() { colour = uColour; }`;

/** The cloud's colour round the eye. */
const VEIL_COLOUR: Vec3 = [0.86, 0.89, 0.92];

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "weather shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "weather program");
  return program;
}

/** A length in a box, wrapped into it: `travel` grows for as long as a flight lasts, and a float does not. */
const wrapped = (travel: Vec3, box: Vec3): Vec3 => [0, 1, 2].map((axis) => ((travel[axis] % box[axis]) + box[axis]) % box[axis]) as Vec3;

/** The vertices of every stretch of the bolts, six to a stretch: where it starts, where it ends, and which corner. */
export function boltStrips(bolts: readonly Bolt[]): Float32Array {
  const corners = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
  const stretches = bolts.reduce((sum, bolt) => sum + Math.max(bolt.points.length - 1, 0), 0);
  const out = new Float32Array(stretches * 6 * 8);
  let at = 0;
  for (const { points } of bolts) {
    for (let i = 0; i + 1 < points.length; i += 1) {
      for (const [along, across] of corners) {
        out.set([...points[i], ...points[i + 1], along, across], at);
        at += 8;
      }
    }
  }
  return out;
}

export interface WeatherPass {
  /** What is beyond the aircraft: drawn before it. And from the cockpit, everything. */
  draw(view: WeatherView): void;
  /**
   * From outside, what goes past round the eye: drawn after the aircraft,
   * through its `range` (the near and far its lens draws it with), and
   * behind it where `depth` says its depth is there to be tested against.
   */
  drawNear(view: WeatherView, range: [number, number], depth: boolean): void;
  dispose(): void;
}

export function makeWeatherPass(gl: WebGL2RenderingContext): WeatherPass {
  const streak = compile(gl, STREAK_VERTEX, STREAK_FRAGMENT);
  const wisp = compile(gl, WISP_VERTEX, WISP_FRAGMENT);
  const bolt = compile(gl, BOLT_VERTEX, BOLT_FRAGMENT);
  const wash = compile(gl, FULL_VERTEX, WASH_FRAGMENT);
  const trail = compile(gl, TRAIL_VERTEX, TRAIL_FRAGMENT);
  // Nothing in it: the streaks and the wisps are made from their numbers alone.
  const empty = gl.createVertexArray()!;
  const boltArray = gl.createVertexArray()!;
  const boltBuffer = gl.createBuffer()!;
  gl.bindVertexArray(boltArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  gl.bindVertexArray(null);
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const uniform = (of: WebGLProgram, name: string) => {
    const known = locations.get(of) ?? new Map<string, WebGLUniformLocation | null>();
    locations.set(of, known);
    if (!known.has(name)) known.set(name, gl.getUniformLocation(of, name));
    return known.get(name) ?? null;
  };

  /** The state every part starts from: blended over what is there, no depth, the whole picture. */
  const begin = () => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return width / Math.max(height, 1);
  };

  /** How bright the cloud is, as the sky lights it. */
  const lightOf = (view: WeatherView) => 0.4 + 0.6 * Math.min(Math.max(view.sky ?? 1, 0), 1);

  /** A box of soft patches of cloud carried past by the air. */
  const patches = (view: WeatherView, modelView: Float32Array, projection: Float32Array, kind: typeof WISPS, centre: Vec3, alpha: number) => {
    gl.useProgram(wisp);
    gl.uniformMatrix4fv(uniform(wisp, "uModelView"), false, modelView);
    gl.uniformMatrix4fv(uniform(wisp, "uProjection"), false, projection);
    gl.uniform3f(uniform(wisp, "uCentre"), ...centre);
    gl.uniform3f(uniform(wisp, "uBox"), ...kind.box);
    gl.uniform3f(uniform(wisp, "uTravel"), ...wrapped(view.travel, kind.box));
    gl.uniform1f(uniform(wisp, "uSize"), kind.size);
    gl.uniform4f(uniform(wisp, "uColour"), 0.9 * lightOf(view), 0.92 * lightOf(view), 0.95 * lightOf(view), alpha);
    gl.drawArrays(gl.TRIANGLES, 0, kind.count * 6);
  };

  /** What goes past the eye: shreds of cloud, and rain, ice and hail in streaks. */
  const goingPast = (view: WeatherView, modelView: Float32Array, projection: Float32Array) => {
    gl.bindVertexArray(empty);
    if (view.wisps > 0.01) patches(view, modelView, projection, WISPS, view.eye, 0.34 * view.wisps);
    // Halfway from the eye to the aircraft, which is where the frame's origin is.
    if (view.shreds > 0.01) patches(view, modelView, projection, SHREDS, view.eye.map((at) => at / 2) as Vec3, 0.5 * view.shreds);
    const speed = Math.hypot(...view.air);
    if (speed > 1) {
      gl.useProgram(streak);
      gl.uniformMatrix4fv(uniform(streak, "uModelView"), false, modelView);
      gl.uniformMatrix4fv(uniform(streak, "uProjection"), false, projection);
      gl.uniform3f(uniform(streak, "uEye"), ...view.eye);
      for (const [fall, amount] of [[RAIN, view.rain], [ICE, view.ice], [HAIL, view.hail]] as const) {
        if (amount <= 0.01) continue;
        const length = Math.min(speed * fall.exposure, fall.longest) / speed;
        gl.uniform3f(uniform(streak, "uBox"), ...fall.box);
        gl.uniform3f(uniform(streak, "uTravel"), ...wrapped(view.travel, fall.box));
        // Drawn out behind it: from where it is back along the way it came.
        gl.uniform3f(uniform(streak, "uStreak"), -view.air[0] * length, -view.air[1] * length, -view.air[2] * length);
        gl.uniform1f(uniform(streak, "uWidth"), fall.width);
        gl.uniform1f(uniform(streak, "uSeed"), fall.seed);
        gl.uniform4f(uniform(streak, "uColour"), ...fall.colour, fall.alpha);
        gl.drawArrays(gl.TRIANGLES, 0, Math.round(fall.count * Math.min(amount, 1)) * 6);
      }
    }
  };

  return {
    draw(view) {
      const { rain, hail, ice, wisps, bolts } = view;
      const lit = bolts.filter((each) => each.brightness > 0.01 && each.points.length > 1);
      const trailing = view.trails.strength > 0.01 && view.trails.from.length > 0;
      const past = !view.outside && (rain > 0.01 || hail > 0.01 || ice > 0.01 || wisps > 0.01);
      if (!past && !lit.length && view.veil <= 0.003 && view.flash <= 0.003 && !trailing) return;
      const aspect = begin();
      const modelView = new Float32Array(view.modelView);
      const projection = new Float32Array(perspective(view.fov, aspect, 0.3, 60_000));

      // Lightning first: the furthest thing here, behind the rain it lights.
      if (lit.length) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(bolt);
        gl.uniformMatrix4fv(uniform(bolt, "uModelView"), false, modelView);
        gl.uniformMatrix4fv(uniform(bolt, "uProjection"), false, projection);
        gl.bindVertexArray(boltArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
        for (const each of lit) {
          const strips = boltStrips([each]);
          gl.bufferData(gl.ARRAY_BUFFER, strips, gl.DYNAMIC_DRAW);
          // Its glow, wide and faint, and the bolt itself in it.
          for (const [wide, strength, colour] of [[0.011, 0.22, [0.6, 0.7, 1]], [0.0022, 1, [0.95, 0.97, 1]]] as const) {
            gl.uniform1f(uniform(bolt, "uWidth"), wide);
            gl.uniform4f(uniform(bolt, "uColour"), colour[0], colour[1], colour[2], strength * each.brightness);
            gl.drawArrays(gl.TRIANGLES, 0, strips.length / 8);
          }
        }
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }

      gl.bindVertexArray(empty);
      if (trailing) {
        gl.useProgram(trail);
        gl.uniformMatrix4fv(uniform(trail, "uModelView"), false, modelView);
        gl.uniformMatrix4fv(uniform(trail, "uProjection"), false, projection);
        gl.uniform1f(uniform(trail, "uLength"), TRAIL_M);
        gl.uniform1f(uniform(trail, "uTime"), (view.travel[0] / -200) % 1000);
        gl.uniform1f(uniform(trail, "uStrength"), Math.min(view.trails.strength, 1));
        for (const from of view.trails.from) {
          gl.uniform3f(uniform(trail, "uFrom"), ...from);
          gl.drawArrays(gl.TRIANGLES, 0, TRAIL_STRETCHES * 6);
        }
      }
      // Cloud round the eye, over the world and the lightning in it; what is nearer than that goes past in front of it.
      gl.useProgram(wash);
      const veil = VEIL_COLOUR.map((channel) => channel * lightOf(view)) as Vec3;
      for (const [colour, strength] of [[veil, view.veil * 0.96], [[1, 1, 1], view.flash * 0.6]] as const) {
        if (strength <= 0.003) continue;
        gl.uniform4f(uniform(wash, "uColour"), colour[0] * strength, colour[1] * strength, colour[2] * strength, strength);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (past) goingPast(view, modelView, projection);

      gl.bindVertexArray(null);
      gl.depthMask(true);
    },

    drawNear(view, range, depth) {
      if (!view.outside) return;
      if (view.rain <= 0.01 && view.hail <= 0.01 && view.ice <= 0.01 && view.wisps <= 0.01 && view.shreds <= 0.01) return;
      const aspect = begin();
      if (depth) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
      }
      goingPast(view, new Float32Array(view.modelView), new Float32Array(perspective(view.fov, aspect, range[0], range[1])));
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
      gl.depthMask(true);
    },

    dispose() {
      for (const program of [streak, wisp, bolt, wash, trail]) gl.deleteProgram(program);
      gl.deleteVertexArray(empty);
      gl.deleteVertexArray(boltArray);
      gl.deleteBuffer(boltBuffer);
    },
  };
}
