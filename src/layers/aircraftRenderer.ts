/**
 * Draws the aircraft of Studio's flight with WebGL: its cockpit round the
 * eye, or the whole of it seen from outside.
 *
 * The aircraft's vertices go straight to the camera
 * (lib/studio/flight/view.ts), with a perspective of its own, into whatever
 * picture it is handed: the 3D map's, where it is a layer over everything
 * (aircraftLayer.ts), or a canvas of its own, where it is a preview of the
 * aircraft and nothing else.
 *
 * Before it, the weather on the glass: cloud round the aircraft whites out
 * what is outside, and the cockpit stays as clear as it was.
 *
 * The cockpit's screens and lights are live: each is a picture handed in (or
 * a part of one), drawn on a sheet just in front of the model's own.
 *
 * An aircraft that has broken up is the same meshes drawn in pieces: each
 * piece that has come off is drawn where it has got to, with only its own
 * side of every mesh that reaches into it, and the hull without it. The
 * shader makes the cut (by where a point is on the model as it was built,
 * lib/studio/flight/model.ts), a ragged one, and blackens what is near it
 * and what is seen of the inside through it. An aircraft in one piece is
 * drawn by a shader that knows nothing of this. A moving part that has come
 * off on its own (a surface fluttered away) is simpler: drawn whole where
 * it has got to, or not at all.
 *
 * Over it all, what burns and bursts (aircraftEffects.ts).
 */
import { BREAKS, cockpitDrives, multiplyInto, parseModel, PartPoser, pieceOf, PIECES, piecesOf, spins, VERTEX_BYTES } from "../lib/studio/flight/model";
import type { AircraftModel, CockpitDrive, CockpitPose, PartPositions } from "../lib/studio/flight/model";
import { blastGlare, makeEffectsPass } from "./aircraftEffects";
import type { EffectsPass } from "./aircraftEffects";
import { perspectiveInto } from "../lib/studio/flight/view";
import { cloudColour, windowPanes } from "../lib/studio/flight/glass";
import type { WindowPane } from "../lib/studio/flight/glass";
import type { Vec3 } from "../lib/studio/flight/view";
import { AIRCRAFT_BYTES, AIRCRAFT_MODEL, fetchAsset, forgetAsset } from "../lib/studio/flight/assets";

/** How the aircraft is seen this frame. */
export interface AircraftView {
  /** The aircraft's frame to the camera's; see `Eye.modelView`. */
  modelView: ArrayLike<number>;
  /** The lens: the vertical field of view, degrees. The map's own, so the two pictures are one. */
  fov: number;
  /** Towards the sun, in the aircraft's frame. */
  light: Vec3;
  /** Whether the eye is in the cockpit: lit as an inside is, and drawn from a hand's breadth away. */
  inside: boolean;
  /** How far cloud round the aircraft hides what is outside, 0 to 1; and a lightning flash, 0 to 1. */
  veil: number;
  flash: number;
  /**
   * How much of the sun reaches the aircraft, and how light the sky round it
   * is, 0 to 1 each: cloud and a storm overhead take both (lib/studio/flight/glass.ts).
   * All of both where not said.
   */
  sunlight?: number;
  daylight?: number;
  /** A lightning strike nearby lighting the aircraft, and from the seat the flight deck, 0 to 1; none where not said. */
  lightning?: number;
  /** From the seat, the weather on the windows; clear, dry glass where not said. */
  glass?: CockpitGlass;
  /**
   * How thick the air between the eye and the aircraft is, per metre: cloud
   * the aircraft is in, seen from outside, takes it from sight the further
   * off it is. None where not said.
   */
  fog?: number;
  /** How far the landing gear is down, 0 up to 1 down; down, as the model has it, where not said. */
  gear?: number;
  /** How far the flaps and slats are out, 0 in to 1 all the way; in where not said. */
  flaps?: number;
  /** How far the spoilers on the wings stand up, 0 flat to 1 all the way; flat where not said. */
  spoilers?: number;
  /**
   * The surfaces the stick and the pedals move, -1 to 1 each, as the
   * controls' own signs have them: `ailerons` right wing down positive (the
   * right one up, the left one down), `elevator` nose up positive (trailing
   * edges up), `rudder` nose right positive (trailing edge right). Neutral
   * where not said.
   */
  ailerons?: number;
  elevator?: number;
  rudder?: number;
  /**
   * Where the flight deck's stick, levers, pedals and handles are (see
   * `CockpitPose`): each as the model has it where not said, and all of
   * them without it.
   */
  cockpit?: CockpitPose;
  /**
   * The engines' fans: how far they have turned, degrees, round and round;
   * and how far they turn while a frame is seen, which, from outside, they
   * are drawn smeared over. Still where not said.
   */
  fans?: { angle: number; sweep: number };
  /**
   * The pieces an aircraft that has broken up is in. A piece named here has
   * come off: it is drawn where its 4x4 puts it (columns first, from where
   * the model has it to where it is now, in the frame `modelView` draws,
   * which stays the hull's), or not at all for null. A piece not named is
   * still on. Whole where not said.
   */
  pieces?: Partial<Record<AircraftPiece, ArrayLike<number> | null>>;
  /**
   * The moving parts no longer on the airframe, by their names in the
   * model's file: a surface that has fluttered off. Each is drawn whole
   * where its 4x4 puts it (as a piece is), or not at all for null; never
   * where it hung. All on where not said.
   */
  lost?: Readonly<Record<string, ArrayLike<number> | null>>;
  /** What burns and bursts on and round it; nothing where not said. */
  effects?: AircraftEffects;
}

/**
 * The weather on the cockpit's windows, as the seat sees it: drawn on the
 * model's own glass, so it stays on the glass as the head turns.
 */
export interface CockpitGlass {
  /** A clock in seconds that only runs forward: what water, hail and fire on the glass move by. */
  time: number;
  /** The true airspeed, m/s: standing, water runs down the glass; at speed the air drives it up and off. */
  speed: number;
  /** How wet the glass is, hail striking it, St Elmo's fire on it, and ice built up on it, 0 to 1 each. */
  wet: number;
  hail: number;
  charge: number;
  frost?: number;
  /** Water drawn in full, or more cheaply for a device that is short of frames; in full where not said. */
  fine?: boolean;
}

/** What an aircraft breaks into besides its hull: each wing with its engine, and the tail with its fin and tailplane. */
export type AircraftPiece = "leftWing" | "rightWing" | "tail";

/**
 * Fire, smoke and blasts, in the frame `modelView` draws (the hull's:
 * metres forward, right, down). `time` is a clock in seconds that only runs
 * forward; each fire and blast says when on it it began.
 */
export interface AircraftEffects {
  time: number;
  /** A fire that burns on: where, how large (metres across), how strong (0 to 1), since when. It trails smoke down `air`. */
  fires: Array<{ at: Vec3; size: number; strength: number; born: number }>;
  /** A blast: a fireball that swells and goes to smoke, with debris thrown out. Where, how large (metres across at its most), when. */
  blasts: Array<{ at: Vec3; size: number; born: number }>;
  /** How the air goes past in that frame, m/s: what carries smoke away. Still for an aircraft lying on the ground. */
  air: Vec3;
  /** Which way is up in that frame, a unit vector: smoke and fire rise that way. */
  up: Vec3;
  /** Without a blast's flash, on the picture and on the aircraft: for a reader who has asked for less motion. With it where not said. */
  calm?: boolean;
}

/** A live screen: a picture, and the four corners it is stretched over, in the aircraft's frame. */
export interface AircraftScreen {
  source: HTMLCanvasElement;
  /** Top left, top right, bottom right, bottom left. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** The part of the picture stretched over them, left, top, right, bottom, 0 to 1; all of it without. */
  uv?: [number, number, number, number];
  /**
   * Counts the picture's changes: it goes to the GPU again only when this
   * has moved on, so a page redrawn now and then costs nothing in between.
   * Without it, it goes every frame.
   */
  version?: number;
  /** Not drawn this frame: a light that is off, which the model's own picture shows dark. */
  hidden?: boolean;
}

/*
 * The aircraft's shaders are one text: with BROKEN defined, the one that
 * draws it in pieces; with GLASS, the one that draws the cockpit's windows
 * from the seat, with the weather on them.
 */
const VERTEX = `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform vec3 uMin;
uniform vec3 uSize;
uniform vec2 uUvMin;
uniform vec2 uUvSize;
out vec3 vNormal;
out vec2 vUv;
out float vFar;
#if defined(BROKEN) || defined(GLASS)
// Where the point is on the model as it was built, and from the eye.
out vec3 vPlace;
out vec3 vSeen;
#endif
void main() {
  vNormal = aNormal;
  vUv = aUv * uUvSize + uUvMin;
  vec4 place = vec4(aPosition * uSize + uMin, 1.0);
  vec4 seen = uModelView * place;
  vFar = length(seen.xyz);
#if defined(BROKEN) || defined(GLASS)
  vPlace = place.xyz;
  vSeen = seen.xyz;
#endif
  gl_Position = uProjection * seen;
}`;

/**
 * St Elmo's fire on the glass, for the glass's shader: short discharges, a
 * fraction of a second each, that feel their way out over it in steps, dim,
 * then flash along the whole of their path and flicker out; violet, white at
 * the core, and branching like a tree as they go. Now here, now there: each
 * half-metre cell of the glass has one or none in each moment, more often
 * the more charged the air, and in patches that come and go. Needs `hash`
 * and `noise` and `uTime` from the shader; `p` is metres over the glass,
 * `pixel` how far over it a pixel goes.
 */
export const ST_ELMO = `
// The distance from p to the segment from a to b, of as much of it as is grown: the discharge has got 'shown' along its path,
// and is 'from' along it at a.
float reached(vec2 p, vec2 a, vec2 b, float from, float shown) {
  if (shown <= from) return 9.0;
  vec2 ab = b - a;
  b = a + ab * min(1.0, (shown - from) / max(length(ab), 1e-5));
  ab = b - a;
  vec2 pa = p - a;
  float h = clamp(dot(pa, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  return length(pa - ab * h);
}
// How near p is to a discharge from 'origin' going 'angle' for about 'reach' metres, grown this share of the way: a jagged trunk of
// eight legs, a branch off most of its joints, a twig off some branches. A branch is thinner, so further from it than it is.
// Nothing of it is further than 1.7 reaches from its origin.
float discharge(vec2 p, vec2 origin, float angle, float reach, float seed, float share) {
  float nearest = 9.0;
  float leg = reach / 8.0;
  float shown = share * reach * 1.7;
  vec2 a = origin;
  float along = 0.0;
  for (int i = 0; i < 8; i += 1) {
    float fi = float(i);
    float turn = angle + (hash(vec2(seed, fi)) - 0.5) * 1.6;
    vec2 b = a + vec2(cos(turn), sin(turn)) * leg * (0.6 + 0.8 * hash(vec2(seed + 1.7, fi)));
    nearest = min(nearest, reached(p, a, b, along, shown));
    if (i > 0 && hash(vec2(seed + 3.1, fi)) < 0.75) {
      float side = hash(vec2(seed + 4.3, fi)) < 0.5 ? -1.0 : 1.0;
      float way = turn + side * (0.5 + 0.7 * hash(vec2(seed + 5.9, fi)));
      vec2 c = a;
      float at = along;
      for (int j = 0; j < 3; j += 1) {
        float fj = float(j) + fi * 4.0;
        float bend = way + (hash(vec2(seed + 6.7, fj)) - 0.5) * 1.2;
        vec2 d = c + vec2(cos(bend), sin(bend)) * leg * (0.5 + 0.6 * hash(vec2(seed + 7.3, fj)));
        nearest = min(nearest, reached(p, c, d, at, shown) * 1.7);
        if (j == 0 && hash(vec2(seed + 8.9, fj)) < 0.5) {
          float twig = bend - side * (0.6 + 0.5 * hash(vec2(seed + 9.7, fj)));
          nearest = min(nearest, reached(p, d, d + vec2(cos(twig), sin(twig)) * leg * 0.7, at + length(d - c), shown) * 2.6);
        }
        at += length(d - c);
        c = d;
      }
    }
    along += length(b - a);
    a = b;
  }
  return nearest;
}
vec3 stElmo(vec2 p, float pixel, float charge) {
  // A cell, metres, and a moment, seconds. A discharge starts in the middle half of its cell and reaches less than 0.6 m,
  // so the point's own cell and the three nearest it are all that can have one over it. Four grids of cells, each shifted
  // from the last, each after the first only in more charge than the one before: up to four times as many at once.
  const float CELL = 0.8;
  const float MOMENT = 0.25;
  float core = 0.0;
  float glow = 0.0;
  for (int layer = 0; layer < 4; layer += 1) {
    float many = layer == 0 ? 1.0 : smoothstep(0.05 + 0.2 * float(layer), 0.35 + 0.2 * float(layer), charge);
    if (many <= 0.0) break;
    vec2 shift = float(layer) * vec2(0.37, 0.61);
    vec2 g = p / CELL + shift;
    vec2 home = floor(g);
    vec2 toward = sign(fract(g) - 0.5);
    for (int k = 0; k < 4; k += 1) {
      vec2 cell = home + vec2(k == 1 || k == 3 ? toward.x : 0.0, k >= 2 ? toward.y : 0.0);
      // Each cell on a clock of its own, so that they do not all strike at once.
      float clock = uTime / MOMENT + hash(cell + 0.7 + float(layer) * 3.3) * 17.0;
      float moment = mod(floor(clock), 997.0);
      vec2 key = cell + vec2(moment * 0.618, moment * 0.347) + float(layer) * 51.0;
      float patches = noise(cell * 0.6 + uTime * 0.07);
      if (hash(key + 2.3) > min(0.95, charge * (0.35 + 0.75 * patches)) * many) continue;
      // Somewhere in the moment, for a fourteenth of a second to a fifth.
      float lasts = 0.07 + 0.13 * hash(key + 4.1);
      float t = (fract(clock) * MOMENT - hash(key + 5.3) * (MOMENT - lasts)) / lasts;
      if (t < 0.0 || t > 1.0) continue;
      vec2 origin = (cell - shift + 0.25 + 0.5 * vec2(hash(key + 6.1), hash(key + 6.9))) * CELL;
      float reach = 0.12 + 0.18 * hash(key + 7.7);
      if (length(p - origin) > reach * 1.7 + 0.05) continue;
      // Out in steps, dim, over the first half of its life; then all of it at once, flickering out.
      float share = (floor(smoothstep(0.0, 0.5, t) * 6.0) + 1.0) / 7.0;
      float flicker = 0.5 + 0.5 * step(0.3, hash(vec2(mod(floor(uTime * 45.0), 991.0), key.x + key.y)));
      float bright = t < 0.5 ? 0.35 + 0.25 * share : exp(-(t - 0.5) * 7.0) * flicker;
      if (t >= 0.5) share = 1.0;
      float d = discharge(p, origin, hash(key + 8.3) * 6.2832, reach, hash(key + 9.1) * 50.0, share);
      float width = max(0.0006, pixel * 0.5);
      core = max(core, (1.0 - smoothstep(width, width + pixel, d)) * bright);
      glow += (exp(-d / 0.006) * 0.6 + exp(-d / 0.03) * 0.2) * bright;
    }
  }
  return vec3(0.84, 0.7, 1.0) * core * 1.4 + vec3(0.55, 0.25, 1.0) * glow;
}
`;

const FRAGMENT = `
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in float vFar;
uniform sampler2D uTexture;
// The cloud between the eye and the point: its colour, and how thick it is per metre.
uniform vec4 uFog;
uniform bool uTextured;
uniform vec3 uColour;
uniform float uOpacity;
uniform vec3 uLight;
// Ambient, lit side, and a little for the side turned away: no face of an inside is black.
uniform vec3 uLighting;
// Light from a lightning strike, on every face alike.
uniform vec3 uFlash;
#if defined(BROKEN) || defined(GLASS)
in vec3 vPlace;
in vec3 vSeen;
uniform mat4 uModelView;
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
#endif
#ifdef GLASS
// A clock, s; the airspeed, m/s.
uniform float uTime;
uniform float uSpeed;
// Water on the glass, hail striking it, St Elmo's fire on it, 0 to 1 each.
uniform float uWet;
uniform float uHail;
uniform float uCharge;
// How much of the sun gets to the glass, how light the sky is, and lightning on it, 0 to 1 each.
uniform float uSun;
uniform float uDay;
uniform float uBolt;
// The picture behind the glass, as it was before the aircraft was drawn, and its size; without it, water is drawn as sky.
uniform sampler2D uScene;
uniform vec2 uViewport;
uniform bool uRefract;
// The water drawn in full: three sizes of bead, running out of their cells, out of round. Without, two sizes, each in its own cell, round.
uniform bool uFine;
// Ice on the glass, 0 to 1; and the windows it grows on (lib/studio/flight/glass.ts's windowPanes): each one's plane, its middle,
// where its edges start in uEdge, how many it has and how deep it is, and every edge.
uniform float uFrost;
uniform int uPanes;
uniform vec4 uPlane[MAX_PANES];
uniform vec3 uMiddle[MAX_PANES];
uniform vec3 uSpan[MAX_PANES];
uniform vec4 uEdge[MAX_EDGES];
// The window a point of the glass is on: the one whose plane it is nearest.
int paneOf(vec3 p) {
  int pane = 0;
  float nearest = 1e9;
  for (int i = 0; i < uPanes; i += 1) {
    float off = abs(dot(uPlane[i].xyz, p) - uPlane[i].w);
    if (off < nearest) {
      nearest = off;
      pane = i;
    }
  }
  return pane;
}
// Noise folded into ridges: 1 along the lines where it crosses its middle, falling away either side.
float ridged(vec2 p) {
  return 1.0 - abs(noise(p) * 2.0 - 1.0);
}
// Frost's crystals at a point an edge's own way: along the edge and in from it, metres. Needles growing in from the edge, with
// branches off them at sixty degrees where a needle is near to grow them; 'detail' fades them to their average where a pixel is
// wider than they are, so they never shimmer.
float crystals(vec2 q, float detail) {
  float needles = pow(ridged(q * vec2(240.0, 30.0) + vec2(0.8 * noise(q * vec2(20.0, 6.0)), 0.0)), 7.0);
  const float SIXTY = 1.0472;
  vec2 left = mat2(cos(SIXTY), sin(SIXTY), -sin(SIXTY), cos(SIXTY)) * q;
  vec2 right = mat2(cos(SIXTY), -sin(SIXTY), sin(SIXTY), cos(SIXTY)) * q;
  float branches = max(pow(ridged(left * vec2(480.0, 70.0) + 7.0), 9.0), pow(ridged(right * vec2(480.0, 70.0) + 13.0), 9.0));
  branches *= smoothstep(0.05, 0.4, pow(ridged(q * vec2(120.0, 15.0) + vec2(0.4 * noise(q * vec2(10.0, 3.0)), 0.0)), 3.0));
  return mix(0.22, max(needles, 0.85 * branches) + 0.12 * noise(q * 900.0), detail);
}
// The bead whose home is the cell 'home' (its corner), as 'bead' says it.
vec3 beadFrom(vec2 p, vec2 home, float seed, float amount, float blow, vec2 way) {
  vec2 cell = home + seed;
  // Most cells have one; those without cost nothing more.
  if (hash(cell + 9.3) > amount) return vec3(9.0, 9.0, 0.0);
  float pace = (0.015 + 0.11 * pow(hash(cell + 3.1), 2.5)) * (1.0 + 2.5 * blow);
  float life = fract(uTime * pace + hash(cell) * 7.0);
  // Mostly small ones, now and then a large one.
  float largest = 0.07 + 0.27 * pow(hash(cell + 5.7), 2.0);
  float grows = 0.05 + 0.55 * hash(cell + 6.3);
  // How long it takes to go, seconds: most within a second or two, some in a blink, some drying away over several; sooner when blown off.
  float going = mix(0.08, 7.0, pow(hash(cell + 7.9), 2.2)) * (1.0 - 0.7 * blow);
  float gone = smoothstep(1.0 - min(0.85, going * pace), 1.0, life);
  // Drying, it shrinks slowly at first and then is gone; one that goes in a blink just goes.
  float size = largest * (0.35 + 0.65 * smoothstep(0.0, grows, life)) * smoothstep(0.0, 0.03, life) * sqrt(max(1.0 - gone, 0.0));
  size *= 1.0 - 0.35 * blow;
  // Standing, only the big ones run, and slowly.
  float runs = blow + (1.0 - blow) * 0.25 * smoothstep(0.24, 0.3, size);
  // How far it goes before it is gone, cells: some hardly move, some run a long way; picking up speed as it goes.
  float travel = runs * mix(0.05, 2.0, pow(hash(cell + 15.0), 1.6)) * mix(life, life * life, 0.5);
  // Drawn coarse, no cell but its own is looked in: none runs out of it.
  if (!uFine) travel = min(travel, 0.3);
  vec2 centre = home + 0.5 + (vec2(hash(cell + 1.3), hash(cell + 2.9)) - 0.5) * max(0.0, 0.9 - 2.0 * largest) + way * travel;
  vec2 d = p - centre;
  // Drawn out along the way it goes, the more the further it has gone.
  float along = dot(d, way) / (1.0 + runs * min(travel, 1.0) * 0.8);
  vec2 across = d - way * dot(d, way);
  float outline = 1.0;
  if (uFine) {
    float turn = atan(d.y, d.x);
    outline += 0.08 * sin(turn * 3.0 + hash(cell + 11.0) * 6.28) + 0.05 * sin(turn * 5.0 + hash(cell + 13.0) * 6.28);
  }
  return vec3((across + way * along) / max(size * outline, 1e-4), size);
}
// The bead of water at a point of the glass, in cells: where the point is in it (its edge at 1 from its middle, a little out of round),
// and how large it is; none (no size) where there is none. Each has a home in a cell, keeps its own time (most sit for many seconds and
// a few go in one or two, at speed all of them sooner), grows as what lands on it gathers, some fast and some slowly, goes in a blink or
// dries away over seconds, and runs the way the water goes ('way'), some hardly at all and some out of its cell and a long way on: so
// the cells upstream of the point are looked in too.
vec3 bead(vec2 p, float seed, float amount, float blow, vec2 way) {
  vec3 nearest = vec3(9.0, 9.0, 0.0);
  float least = 9.0;
  // Standing, none runs further than its own cell and the next.
  int reach = !uFine ? 1 : blow > 0.05 ? 3 : 2;
  for (int upstream = 0; upstream < reach; upstream += 1) {
    vec3 at = beadFrom(p, floor(p - way * float(upstream)), seed, amount, blow, way);
    float r = at.z > 1e-3 ? length(at.xy) : 9.0;
    if (r < least) {
      least = r;
      nearest = at;
    }
  }
  return nearest;
}
${ST_ELMO}
#endif
#ifdef BROKEN
// The pieces this draw is of, a bit each (hull, left wing, right wing, tail); all four for a mesh that is not cut.
uniform int uKeep;
// Where the wings and the tail come off, and how far a break wanders from its line; metres.
uniform vec3 uBreaks;
// Which breaks are open: the left wing's, the right wing's, the tail's.
uniform vec3 uTorn;
#endif
out vec4 colour;
void main() {
  vec4 base = uTextured ? texture(uTexture, vUv) : vec4(uColour, 1.0);
  float facing = dot(normalize(vNormal), uLight);
  float lit = uLighting.x + uLighting.y * max(facing, 0.0) + uLighting.z * max(-facing, 0.0);
#ifdef BROKEN
  // How far the point is past each break, the ragged way a torn skin runs: positive is off the hull.
  float root = uBreaks.x + uBreaks.z * (noise(vPlace.xz * 2.6) * 2.0 - 1.0);
  float left = -vPlace.y - root;
  float right = vPlace.y - root;
  float tail = uBreaks.y + uBreaks.z * (noise(vPlace.yz * 2.6 + 7.0) * 2.0 - 1.0) - vPlace.x;
  int piece = tail > 0.0 ? 3 : left > 0.0 ? 1 : right > 0.0 ? 2 : 0;
  if (((uKeep >> piece) & 1) == 0) discard;
  // Burnt black near an open break: at a wing's, as far as the wing's root reaches along and up the fuselage.
  vec2 off = vec2(max(max(vPlace.x - 4.5, -2.5 - vPlace.x), 0.0), max(max(vPlace.z - 1.7, 0.3 - vPlace.z), 0.0));
  float near = min(
    min(uTorn.x > 0.5 ? length(vec3(left, off)) : 9.0, uTorn.y > 0.5 ? length(vec3(right, off)) : 9.0),
    uTorn.z > 0.5 ? abs(tail) : 9.0);
  // In patches, whichever way the skin there faces.
  float soot = (noise(vPlace.xy * 2.7) + noise(vPlace.xz * 2.7 + 5.0) + noise(vPlace.yz * 2.7 + 9.0)) / 3.0;
  soot += (noise(vPlace.xy * 11.0) + noise(vPlace.xz * 11.0 + 5.0) + noise(vPlace.yz * 11.0 + 9.0) - 1.5) * 0.12;
  float burnt = 1.0 - smoothstep(0.0, 0.9, near + (soot - 0.5) * 0.9);
  // And what is seen from behind, through a break: the inside of a skin, in the dark and sooted.
  vec3 face = normalize(cross(dFdx(vSeen), dFdy(vSeen)));
  if (dot(face, mat3(uModelView) * vNormal) < 0.0) face = -face;
  float inner = dot(face, vSeen) > 0.0 ? 1.0 : 0.0;
  base.rgb = mix(base.rgb, vec3(0.035, 0.03, 0.028), max(burnt * 0.93, inner * 0.55));
  lit *= 1.0 - 0.55 * inner;
#endif
  float alpha = base.a * uOpacity;
  // Never quite gone: a shape in the cloud, which is how an aircraft in one is seen from close behind.
  float fogged = min(1.0 - exp(-vFar * uFog.w), 0.93);
  colour = vec4(mix(base.rgb * (vec3(lit) + uFlash), uFog.rgb, fogged) * alpha, alpha);
#ifdef GLASS
  vec3 n = normalize(vNormal);
  // Metres over the glass: across and up the windshield, along and up a side window (down is positive, as the model has it).
  bool side = abs(n.y) > 0.6;
  vec2 onGlass = side ? vPlace.xz : vPlace.yz;
  // How far over the glass a pixel across the screen goes, and one up it.
  mat2 perPixel = mat2(dFdx(onGlass), dFdy(onGlass));
  // Standing, water runs down the glass; at speed the air drives it up the windshield and out to its sides, and aft along a side window.
  float blow = smoothstep(15.0, 70.0, uSpeed);
  vec2 driven = side ? normalize(vec2(-1.0, -0.2)) : normalize(vec2(sign(vPlace.y) * 0.35, -1.0));
  vec2 way = normalize(mix(vec2(0.0, 1.0), driven, blow) + vec2(1e-4, 0.0));
  vec3 sky = vec3(0.74, 0.8, 0.88) * (0.3 + 0.7 * uDay) + vec3(0.85, 0.9, 1.0) * uBolt;

  // The sun through the glass: a haze where it is looked towards, and fine scratches round it that catch it.
  vec3 eyeWay = normalize(vSeen);
  vec3 sunWay = normalize(mat3(uModelView) * uLight);
  float toward = max(dot(eyeWay, sunWay), 0.0);
  vec3 light = vec3(1.0, 0.96, 0.88) * (pow(toward, 5.0) * 0.08 + pow(toward, 40.0) * 0.3 + pow(toward, 600.0) * 0.6) * uSun;
  if (uSun > 0.01 && toward > 0.9) {
    // Only those square to the way to the sun glint, so they are seen in rings round it.
    vec3 off = eyeWay - sunWay * toward;
    vec3 first = normalize(cross(sunWay, abs(sunWay.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float turn = atan(dot(off, cross(sunWay, first)), dot(off, first));
    float rings = smoothstep(0.7, 0.95, noise(vec2(turn * 45.0, length(off) * 350.0))) * smoothstep(3.14, 2.9, abs(turn));
    light += vec3(1.0, 0.97, 0.9) * rings * noise(onGlass * 500.0) * pow(toward, 60.0) * 0.6 * uSun;
  }
  // A flash lights what is on the glass, and the glass itself a little.
  light += sky * uBolt * 0.06;

  vec4 water = vec4(0.0);
  if (uWet > 0.01) {
    /* Each drop a lens: the world behind it seen through it small and upside
       down, a dark line where its edge bends the light away, a glint of the
       sky at its head. Where it is, the bead or stream nearest to covering
       the point; how far it bends the view, as metres over the glass. */
    float cover = 0.0;
    vec2 bend = vec2(0.0);
    float rim = 0.0;
    float glint = 0.0;
    int layers = uFine ? 3 : 2;
    for (int layer = 0; layer < layers; layer += 1) {
      // Three sizes of cell, each turned and shifted from the others, so that no grid shows.
      float cell = layer == 0 ? 0.011 : layer == 1 ? 0.0068 : 0.0043;
      float angle = float(layer) * 2.1;
      mat2 turned = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
      vec3 at = bead(turned * onGlass / cell + float(layer) * 0.37, float(layer) * 41.0, uWet * (layer == 0 ? 0.6 : layer == 1 ? 0.75 : 0.9), blow, turned * way);
      at.xy = transpose(turned) * at.xy;
      float r = length(at.xy);
      float edge = min(fwidth(r) * 1.5, 0.5);
      float inside = smoothstep(1.0, 1.0 - edge, r) * step(1e-3, at.z);
      if (inside > cover) {
        cover = inside;
        // A drop's lens takes in a field several times its own size, and more towards its edge.
        bend = -at.xy * at.z * cell * (6.0 + 6.0 * r * r);
        rim = smoothstep(0.55, 1.0, r);
        glint = smoothstep(0.22, 0.0, length(at.xy - vec2(-0.32, -0.38)));
      }
    }
    // And at speed, water streaming off in rivulets: long thin lenses, bending the view across them.
    if (blow > 0.05) {
      vec2 q = vec2(driven.y * onGlass.x - driven.x * onGlass.y, dot(onGlass, driven));
      float lane = q.x / 0.008;
      float id = floor(lane);
      float along = (q.y - uTime * (0.4 + uSpeed * 0.02) * (0.7 + 0.6 * hash(vec2(id, 4.1)))) * 5.0;
      float s = fract(along);
      float thick = 0.05 + 0.08 * hash(vec2(id, floor(along) + 0.5));
      float across = fract(lane) - 0.5 - (hash(vec2(id, 1.7)) - 0.5) * 0.4 + 0.08 * sin(q.y * 60.0 + id);
      float edge = min(fwidth(across / thick) * 1.5, 0.5);
      float stream = step(hash(vec2(id, floor(along))), uWet * 0.35) * smoothstep(1.0, 1.0 - edge, abs(across) / thick)
        * smoothstep(0.0, 0.6, s) * smoothstep(1.0, 0.94, s) * blow;
      if (stream > cover) {
        cover = stream;
        bend = -vec2(driven.y, -driven.x) * across * 0.008 * 4.0;
        rim = smoothstep(0.6, 1.0, abs(across) / thick);
        glint = 0.0;
      }
    }
    vec3 through = sky * 0.55;
    if (uRefract) {
      // The bend over the glass as pixels on the screen, by how far the glass goes for a pixel each way here.
      // Glass seen edge on has no inverse: nothing is bent there.
      vec2 shift = abs(determinant(perPixel)) > 1e-14 ? inverse(perPixel) * bend : vec2(0.0);
      shift *= min(1.0, 90.0 / max(length(shift), 1e-3));
      through = texture(uScene, (gl_FragCoord.xy + shift) / uViewport).rgb;
    }
    vec3 seen = through * (1.04 - 0.75 * rim) + sky * 0.03;
    water = vec4(seen * cover, cover);
    light += glint * cover * (sky * 0.35 + vec3(1.0, 0.97, 0.9) * uSun * pow(toward, 2.0) * 1.2 + vec3(0.9, 0.93, 1.0) * uBolt * 0.7);
  }

  // Hail striking the glass: a white burst that is gone again at once.
  if (uHail > 0.01) {
    vec2 g = onGlass / 0.06;
    vec2 cell = floor(g);
    float beat = fract(uTime * (0.6 + hash(cell + 33.0)) + hash(cell + 31.0) * 5.0);
    vec2 d = fract(g) - 0.5 - (vec2(hash(cell + 35.0), hash(cell + 37.0)) - 0.5) * 0.5;
    float spikes = 0.6 + 0.4 * sin(atan(d.y, d.x) * 7.0 + hash(cell) * 20.0);
    light += vec3(0.95) * 0.8 * step(hash(cell + 39.0), uHail * 0.5) * (1.0 - smoothstep(0.0, 0.2, beat))
      * smoothstep(0.1 * spikes + 0.02, 0.0, length(d));
  }

  // St Elmo's fire: short violet discharges finding their way over the glass; a few in a little charge, many in a lot.
  float pixel = length(fwidth(onGlass));
  if (uCharge > 0.01) light += stElmo(onGlass, pixel, uCharge);

  // The water over the glass.
  colour = vec4(water.rgb + colour.rgb * (1.0 - water.a), water.a + colour.a * (1.0 - water.a));

  // Ice: grown in from the edges of each window, further in the more of it there is; on the pane, so it stays where it is on its
  // window however the head turns. Thick and white at the frame, and beyond that crystals: needles growing in from the edge with
  // branches off them at sixty degrees, as frost grows, thinning to a few reaching out ahead of the rest.
  if (uFrost > 0.01 && uPanes > 0) {
    // How far in from its window's edges the point is: 0 at an edge, 1 in the middle, a corner (edged twice) further from it.
    // And the two edges nearest it, and how far in from each.
    int pane = paneOf(vPlace);
    vec3 span = uSpan[pane];
    float sum = 0.0;
    float d1 = 1e9;
    float d2 = 1e9;
    vec4 e1 = vec4(0.0);
    vec4 e2 = vec4(0.0);
    for (int e = 0; e < int(span.y); e += 1) {
      vec4 edge = uEdge[int(span.x) + e];
      float d = edge.w - dot(edge.xyz, vPlace);
      sum += exp(-max(d, 0.0) / span.z / 0.08);
      if (d < d1) {
        d2 = d1;
        e2 = e1;
        d1 = d;
        e1 = edge;
      } else if (d < d2) {
        d2 = d;
        e2 = edge;
      }
    }
    float edge = 1.0 - clamp(-0.08 * log(max(sum, 1e-30)), 0.0, 1.0);
    float patchy = 0.55 * noise(onGlass * 24.0) + 0.45 * noise(onGlass * 70.0 + 3.1);
    float reach = 1.0 - uFrost * (0.5 + 0.35 * patchy);
    float grown = smoothstep(reach - 0.1, reach + 0.08, edge);
    float thick = smoothstep(reach + 0.03, reach + 0.3, edge);
    // Each edge grows its own crystals, straight in from it; where two meet, theirs run into each other.
    // (From the window's middle: millimetres are lost in metres from the model's origin.)
    float detail = 1.0 - smoothstep(0.35, 1.1, length(fwidth(vPlace)) * 480.0);
    vec3 facing = uPlane[pane].xyz;
    vec3 local = vPlace - uMiddle[pane];
    vec2 onPane = side ? local.xz : local.yz;
    float first = crystals(vec2(dot(local, cross(facing, e1.xyz)), d1), detail);
    float second = crystals(vec2(dot(local, cross(facing, e2.xyz)), d2) + 17.3, detail);
    float crystal = mix(first, second, 1.0 / (1.0 + exp((d2 - d1) / 0.012)));
    float ice = grown * clamp(0.12 + 0.8 * crystal + 0.7 * thick, 0.0, 0.94) * min(1.0, uFrost * 2.5);

    // White as the light it scatters: the sky's, the sun's where the ice is looked at towards it, and lightning's.
    vec3 white = vec3(0.88, 0.93, 0.98) * (0.45 + 0.55 * uDay) + vec3(1.0, 0.97, 0.9) * pow(toward, 4.0) * 0.5 * uSun
      + vec3(0.85, 0.9, 1.0) * uBolt * 0.4;
    // Thin ice is seen through, the world behind it scattered: drawn from round the point, and lightened.
    if (uRefract && uFine) {
      vec2 per = vec2(1.0) / uViewport;
      float spin = hash(floor(gl_FragCoord.xy)) * 6.283;
      vec3 scattered = vec3(0.0);
      for (int tap = 0; tap < 4; tap += 1) {
        float turn = spin + float(tap) * 1.5708;
        scattered += texture(uScene, (gl_FragCoord.xy + vec2(cos(turn), sin(turn)) * (5.0 + 9.0 * float(tap & 1))) * per).rgb;
      }
      white = mix(scattered * 0.25 * 1.15 + 0.12 * white, white, clamp(crystal * 0.9 + thick, 0.0, 1.0));
    }
    // Each crystal a tiny prism, turned its own way: it flashes where it bends the sun behind it into the eye, so looking sunwards
    // the ice glitters, and the glints move over it as the head does; split a little into colours, as ice splits light.
    vec3 sparkle = vec3(0.0);
    if (uSun > 0.01 && detail > 0.01) {
      vec2 facet = floor(onPane / 0.0016) + float(pane) * 101.0;
      vec3 tilt = vec3(hash(facet + 0.7), hash(facet + 1.9), hash(facet + 4.3)) - 0.5;
      vec3 bent = normalize(eyeWay + mat3(uModelView) * tilt * 1.2);
      float glint = pow(max(dot(bent, sunWay), 0.0), 300.0);
      vec3 hue = 0.5 + 0.5 * cos(6.2832 * (hash(facet + 8.1) + vec3(0.0, 0.33, 0.67)));
      sparkle = mix(vec3(1.0), hue, 0.55) * glint * 2.5 * uSun * detail * step(0.55, hash(facet + 2.2)) * grown * (0.3 + crystal);
    }
    colour = vec4(white * ice + colour.rgb * (1.0 - ice), ice + colour.a * (1.0 - ice));
    light += sparkle;
  }

  // And the light on it all, added to what is seen through it.
  colour.rgb += light;
#endif
}`;

const WHOLE = "#version 300 es\n";
const BROKEN = "#version 300 es\n#define BROKEN\n";
/** The most windows ice is drawn on, and the most edges of them all. */
const MAX_PANES = 8;
const MAX_EDGES = 64;
const GLASS = `#version 300 es\n#define GLASS\n#define MAX_PANES ${MAX_PANES}\n#define MAX_EDGES ${MAX_EDGES}\n`;

/** The cockpit's windows as the glass's shader takes them: as many as fit. */
interface PackedWindows {
  count: number;
  planes: Float32Array;
  middles: Float32Array;
  spans: Float32Array;
  edges: Float32Array;
}

function packWindows(panes: readonly WindowPane[]): PackedWindows {
  const planes = new Float32Array(MAX_PANES * 4);
  const middles = new Float32Array(MAX_PANES * 3);
  const spans = new Float32Array(MAX_PANES * 3);
  const edges = new Float32Array(MAX_EDGES * 4);
  let count = 0;
  let first = 0;
  for (const pane of panes) {
    if (count === MAX_PANES || first + pane.edges.length > MAX_EDGES) break;
    planes.set(pane.plane, count * 4);
    middles.set(pane.middle, count * 3);
    spans.set([first, pane.edges.length, pane.depth], count * 3);
    pane.edges.forEach((edge, i) => edges.set(edge, (first + i) * 4));
    first += pane.edges.length;
    count += 1;
  }
  return { count, planes, middles, spans, edges };
}
/** Every piece's bit: what a mesh that needs no cutting is drawn with. */
const EVERY_PIECE = (1 << PIECES.length) - 1;
/** What every mesh of an aircraft in one piece is drawn as part of: the hull, which is the first of `PIECES`. */
const ALL_HULL = [0];

/** One triangle over the whole picture, in one colour: the veil of cloud, the flash. */
const VEIL_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const VEIL_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColour;
out vec4 colour;
void main() { colour = uColour; }`;

/** How near and how far the aircraft is drawn from, metres: from a seat, and from outside. */
const INSIDE_RANGE: [number, number] = [0.05, 150];
export const OUTSIDE_RANGE: [number, number] = [2, 4000];

/** How near the eye smoke and flame begin to be drawn, and from where in full, metres: none is cut off sharp by the lens's near edge. */
const INSIDE_FADE: [number, number] = [0.3, 2.5];
const OUTSIDE_FADE: [number, number] = [2, 12];

/** Ambient, lit, turned away; see the shader. */
const INSIDE_LIGHTING: Vec3 = [0.62, 0.42, 0.1];
const OUTSIDE_LIGHTING: Vec3 = [0.5, 0.62, 0.05];
/** A screen glows: its picture as it is. */
const SCREEN_LIGHTING: Vec3 = [1, 0, 0];

/** From inside, the windshield is looked through, not at: this much of its own tint. */
const GLASS_FROM_INSIDE = 0.2;

/** A lightning strike's light, at its brightest: blue-white, and stronger on a flight deck than on a hull in the open sky. */
const LIGHTNING_COLOUR: Vec3 = [0.78, 0.84, 1];
const LIGHTNING_INSIDE = 0.95;
const LIGHTNING_OUTSIDE = 0.55;

/**
 * The light an aircraft is lit by as the sky has it: ambient, lit side and
 * the side turned away (see the shader), from `daylight` and `sunlight`
 * (`AircraftView`). Cloud takes the sun, and leaves a flat grey that is
 * still most of the ambient; a storm's dark takes more.
 */
export function skyLighting(base: Readonly<Vec3>, sunlight = 1, daylight = 1, out: Vec3 = [0, 0, 0]): Vec3 {
  const sun = Math.min(Math.max(sunlight, 0), 1);
  const day = Math.min(Math.max(daylight, 0), 1);
  const ambient = base[0], lit = base[1], away = base[2];
  out[0] = ambient * (0.6 + 0.4 * day) + lit * 0.25 * (1 - sun) * day;
  out[1] = lit * sun * day;
  out[2] = away * day;
  return out;
}

/* The model and its textures, fetched once for the page: a style change
   takes the layer off the map and puts a new one on, and that one starts
   from what is already here. */
let loading: Promise<{ model: AircraftModel; images: Array<ImageBitmap | null> }> | null = null;

/** How much of the textures has come, bytes, and of how much; `known` once every one of them has said its size. */
type TextureProgress = (loaded: number, total: number, known: boolean) => void;
const textureListeners = new Set<TextureProgress>();
let textureProgress: [number, number, boolean] = [0, 0, false];

/**
 * The aircraft's model and its textures, from where they are served, the
 * textures decoded; the same ones to every caller. The model's bytes are the
 * page's one fetch of them (lib/studio/flight/assets.ts), which the flight's
 * loading may have begun already; `textures` hears how far the textures are.
 */
export function loadAircraft(base: string, textures?: TextureProgress) {
  if (textures) {
    textureListeners.add(textures);
    textures(...textureProgress);
  }
  loading ??= (async () => {
    const model = parseModel(await fetchAsset(`${base}${AIRCRAFT_MODEL}`, AIRCRAFT_BYTES));
    const files = model.materials.map(({ texture }) => texture).filter((texture): texture is string => Boolean(texture));
    const sizes = new Map<string, [number, number]>();
    const tell = () => {
      let [loaded, total] = [0, 0];
      for (const [got, of] of sizes.values()) {
        loaded += got;
        total += of;
      }
      textureProgress = [loaded, total, sizes.size === new Set(files).size];
      for (const listener of textureListeners) listener(...textureProgress);
    };
    const images = await Promise.all(model.materials.map(async ({ texture }) => {
      if (!texture) return null;
      try {
        const url = `${base}${texture}`;
        const bytes = await fetchAsset(url, 0, (got, of) => {
          sizes.set(texture, [got, of]);
          tell();
        });
        const image = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: "none" });
        forgetAsset(url);
        return image;
      } catch {
        // Drawn untextured.
        return null;
      }
    }));
    return { model, images };
  })();
  // A failed fetch is tried again by the next flight.
  loading.catch(() => { loading = null; });
  return loading;
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "aircraft shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "aircraft program");
  return program;
}

interface Drawn {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  material: number;
  min: Vec3;
  size: Vec3;
  uvMin: [number, number];
  uvSize: [number, number];
  /** The moving part it belongs to; see `posedParts`. */
  part?: string;
  /** Whether that part spins, and is of a fan's blades: drawn only as their smear while it is smeared. */
  spins: boolean;
  bladed: boolean;
  /**
   * The pieces it has something of, by their places in `PIECES`: a moving
   * part is of one piece, whole; the rest, of every piece its box reaches.
   */
  pieces: number[];
}

/**
 * A piece as one frame draws it: through which model-view, lit from where
 * (in its own frame), and its moving parts where they are, and those that
 * spin as their smears (none for a fan seen still). Kept and written over.
 */
interface Frame {
  modelView: Float32Array;
  light: Vec3;
  poser: PartPoser;
}

/** The flight deck's controls, each as the model has it where `AircraftView.cockpit` does not say. */
const COCKPIT_DRIVES: readonly CockpitDrive[] = [
  "stickPitch", "stickRoll", "thrustLevers", "flapLever", "speedBrakeLever", "spoilersArmed", "gearLever", "pedals", "parkingBrake", "rudderTrim",
];

/** A unit square's vertices in the model's own packing, for a screen stretched over four corners. */
function screenVertices(): Uint8Array {
  const bytes = new Uint8Array(4 * VERTEX_BYTES);
  const view = new DataView(bytes.buffer);
  // Top left, top right, bottom right, bottom left: the picture's own corners.
  ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).forEach(([u, v], i) => {
    view.setUint16(i * VERTEX_BYTES, i, true);
    view.setUint16(i * VERTEX_BYTES + 12, u * 65535, true);
    view.setUint16(i * VERTEX_BYTES + 14, v * 65535, true);
  });
  return bytes;
}

const SCREEN_VERTEX = `
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform vec3 uCorners[4];
uniform vec4 uPart;
out vec3 vNormal;
out vec2 vUv;
out float vFar;
void main() {
  vNormal = vec3(0.0, 0.0, 1.0);
  vUv = mix(uPart.xy, uPart.zw, aUv);
  // The first coordinate counts the corner, one step of 65535 each.
  vec4 seen = uModelView * vec4(uCorners[int(aPosition.x * 65535.0 + 0.5)], 1.0);
  vFar = length(seen.xyz);
  gl_Position = uProjection * seen;
}`;

/** What draws the aircraft into one WebGL picture. */
export interface AircraftRenderer {
  /** Hand over the model, once it is loaded. */
  upload(model: AircraftModel, images: Array<ImageBitmap | null>): void;
  /** Draw the aircraft as `view` sees it, over whatever is in the picture, with `screens` lit in its cockpit. */
  /** Draw it; true once it has, which leaves its depth for what goes past in front of it (weatherPass.ts). */
  draw(view: AircraftView, screens: readonly AircraftScreen[]): boolean;
  /**
   * Draw it as `view` sees it once more, from outside, into a rectangle of
   * the picture only (`x` and `y` its lower left corner, in the drawing
   * buffer's pixels, as WebGL counts them): over what is there, with a
   * depth of its own there, and none of what `draw` does once a frame (the
   * veil, the glass). How many draws that took; none where the model has
   * not come yet.
   */
  drawInset(view: AircraftView, x: number, y: number, width: number, height: number): number;
  /** Let go of everything it holds on the GPU. */
  dispose(): void;
}

export function makeAircraftRenderer(context: WebGL2RenderingContext): AircraftRenderer {
  const program = compile(context, WHOLE + VERTEX, WHOLE + FRAGMENT);
  const veil = compile(context, VEIL_VERTEX, VEIL_FRAGMENT);
  const screen = compile(context, WHOLE + SCREEN_VERTEX, WHOLE + FRAGMENT);
  /* Made when first needed, and by most flights never: the shader of an aircraft in pieces, and what burns. */
  let torn: WebGLProgram | null = null;
  let glass: WebGLProgram | null = null;
  /*
   * The picture behind the windows, copied before the aircraft is drawn, for
   * water on the glass to bend: made when first wet. At half the picture's
   * size each way, which is plenty for what a drop shows of it, smaller than
   * itself, and a quarter of the memory; shrunk on the way by a blit, or
   * where the picture cannot be blitted from (an antialiased one), copied
   * whole instead.
   */
  let behind: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number; whole: boolean } | null = null;
  /** Whether the first blit has been checked for an error, and whether it failed: copied whole from then on. */
  let blitChecked = false;
  let blitFails = false;

  function forgetBehind(): void {
    if (!behind) return;
    context.deleteTexture(behind.texture);
    context.deleteFramebuffer(behind.framebuffer);
    behind = null;
  }

  function copyBehind(width: number, height: number): void {
    const gl = context;
    const whole = blitFails;
    const [w, h] = whole ? [width, height] : [Math.max(1, width >> 1), Math.max(1, height >> 1)];
    if (behind && (behind.width !== w || behind.height !== h || behind.whole !== whole)) forgetBehind();
    gl.activeTexture(gl.TEXTURE1);
    if (!behind) {
      behind = { texture: gl.createTexture()!, framebuffer: gl.createFramebuffer()!, width: w, height: h, whole };
      gl.bindTexture(gl.TEXTURE_2D, behind.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, behind.texture);
    if (whole) {
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    } else {
      // From whatever the map draws into, to the texture, and the map's own bindings back as they were.
      const drawing = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const reading = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, behind.framebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, behind.texture, 0);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawing);
      const tried = !blitChecked;
      if (tried) while (gl.getError() !== gl.NO_ERROR) { /* what came before is not this blit's */ }
      gl.blitFramebuffer(0, 0, width, height, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawing);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, reading);
      // Asked once only: asking waits for the GPU.
      if (tried) {
        blitChecked = true;
        if (gl.getError() !== gl.NO_ERROR) blitFails = true;
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }
  let effects: EffectsPass | null = null;
  const screenVao = context.createVertexArray()!;
  let drawn: Drawn[] = [];
  let textures: Array<WebGLTexture | null> = [];
  /* Each picture's texture, by picture: one picture may light several screens, and goes up once. */
  const screenTextures = new Map<HTMLCanvasElement, { texture: WebGLTexture; version: number | undefined; width: number; height: number }>();
  let materials: AircraftModel["materials"] = [];
  let parts: AircraftModel["parts"] = {};
  let windows = packWindows([]);
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  const uniform = (of: WebGLProgram, name: string) => {
    const known = locations.get(of) ?? new Map<string, WebGLUniformLocation | null>();
    locations.set(of, known);
    if (!known.has(name)) known.set(name, context.getUniformLocation(of, name));
    return known.get(name) ?? null;
  };

  function attributes(gl: WebGL2RenderingContext): void {
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.BYTE, true, VERTEX_BYTES, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.UNSIGNED_SHORT, true, VERTEX_BYTES, 12);
  }

  context.bindVertexArray(screenVao);
  const corners = context.createBuffer()!;
  context.bindBuffer(context.ARRAY_BUFFER, corners);
  context.bufferData(context.ARRAY_BUFFER, screenVertices(), context.STATIC_DRAW);
  attributes(context);
  const order = context.createBuffer()!;
  context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, order);
  context.bufferData(context.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), context.STATIC_DRAW);
  context.bindVertexArray(null);
  const screenBuffers = [corners, order];

  function upload(model: AircraftModel, images: Array<ImageBitmap | null>): void {
    const gl = context;
    materials = model.materials;
    parts = model.parts;
    framePool = null;
    windows = packWindows(windowPanes(model));
    const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
    textures = images.map((image) => {
      if (!image) return null;
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      // A panel is looked along, not at: without it its labels smear.
      if (anisotropy) {
        gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
      return texture;
    });
    drawn = model.chunks.map((chunk) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vertices = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);
      attributes(gl);
      const indices = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);
      const middle = chunk.min.map((least, axis) => least + chunk.size[axis] / 2);
      return {
        vao, buffers: [vertices, indices], count: chunk.indices.length, material: chunk.material,
        min: chunk.min, size: chunk.size, uvMin: chunk.uvMin, uvSize: chunk.uvSize, part: chunk.part,
        spins: chunk.part !== undefined && spins(model.parts[chunk.part]),
        bladed: chunk.part !== undefined && spins(model.parts[chunk.part]) && (model.parts[chunk.part].blades ?? 0) > 0,
        pieces: (chunk.part ? [pieceOf(middle)] : piecesOf(chunk.min, chunk.size)).map((piece) => PIECES.indexOf(piece)),
      };
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function drawScreens(view: AircraftView, screens: readonly AircraftScreen[], projection: ArrayLike<number>): void {
    const gl = context;
    if (!screens.length) return;
    gl.useProgram(screen);
    gl.uniformMatrix4fv(uniform(screen, "uModelView"), false, new Float32Array(view.modelView));
    gl.uniformMatrix4fv(uniform(screen, "uProjection"), false, new Float32Array(projection));
    gl.uniform1i(uniform(screen, "uTexture"), 0);
    gl.uniform1i(uniform(screen, "uTextured"), 1);
    gl.uniform1f(uniform(screen, "uOpacity"), 1);
    gl.uniform3f(uniform(screen, "uLight"), 0, 0, 1);
    gl.uniform3f(uniform(screen, "uLighting"), ...SCREEN_LIGHTING);
    gl.uniform3f(uniform(screen, "uFlash"), 0, 0, 0);
    // A screen is looked at from the seat, through no cloud.
    gl.uniform4f(uniform(screen, "uFog"), 0, 0, 0, 0);
    gl.bindVertexArray(screenVao);
    gl.activeTexture(gl.TEXTURE0);
    // A light's picture has clear parts round it: the panel shows through them.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const uploaded = new Set<HTMLCanvasElement>();
    for (const { source, corners, uv, version, hidden } of screens) {
      if (hidden || !source.width || !source.height) continue;
      let held = screenTextures.get(source);
      if (!held) {
        held = { texture: gl.createTexture()!, version: undefined, width: 0, height: 0 };
        screenTextures.set(source, held);
        gl.bindTexture(gl.TEXTURE_2D, held.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, held.texture);
      }
      const stale = version === undefined || version !== held.version
        || held.width !== source.width || held.height !== source.height;
      if (stale && !uploaded.has(source)) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        held.version = version;
        held.width = source.width;
        held.height = source.height;
        uploaded.add(source);
      }
      gl.uniform4fv(uniform(screen, "uPart"), uv ?? [0, 0, 1, 1]);
      gl.uniform3fv(uniform(screen, "uCorners"), new Float32Array(corners.flat()));
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
  }

  /*
   * What one aircraft's drawing keeps from frame to frame, so that it makes
   * nothing anew: its lens, where its moving parts are, and a frame for the
   * hull, for each piece that has come off and for each part that has.
   */
  const projection = new Float32Array(16);
  const positions: PartPositions = { gear: 1, flaps: 0, spoilers: 0 };
  const lighting: Vec3 = [0, 0, 0];
  let framePool: { hull: Frame; pieces: Frame[]; loose: Map<string, Frame> } | null = null;
  const frames: Array<Frame | null> = PIECES.map(() => null);
  const loose = new Map<string, Frame | null>();
  const blankFrame = (): Frame => ({ modelView: new Float32Array(16), light: [0, 0, 0], poser: new PartPoser(parts) });
  /** Of the pieces a mesh reaches into, those drawn through `through` this frame: a bit each. */
  const keptOf = (pieces: readonly number[], through: Frame): number => {
    let keep = 0;
    for (const other of pieces) if (frames[other] === through) keep |= 1 << other;
    return keep;
  };
  const allKept = (pieces: readonly number[], keep: number): boolean => {
    for (const other of pieces) if (!(keep & (1 << other))) return false;
    return true;
  };

  /** What the aircraft drawn now is drawn with, for what draws its meshes: kept, never made anew. */
  const drawing = { view: null as unknown as AircraftView, broken: false, glare: 0, flash: 0, fogLight: 1, sweep: 0, calls: 0 };

  // What every mesh is drawn with alike, for whichever shader draws it.
  function prepare(using: WebGLProgram): void {
    const webgl = context;
    const { view, glare, flash, fogLight } = drawing;
    webgl.useProgram(using);
    webgl.uniformMatrix4fv(uniform(using, "uProjection"), false, projection);
    webgl.uniform3f(uniform(using, "uLighting"), lighting[0] + 0.55 * glare, lighting[1], lighting[2]);
    webgl.uniform3f(uniform(using, "uFlash"), LIGHTNING_COLOUR[0] * flash, LIGHTNING_COLOUR[1] * flash, LIGHTNING_COLOUR[2] * flash);
    webgl.uniform1i(uniform(using, "uTexture"), 0);
    // The cloud the aircraft goes from sight in is the one round the eye, lit as the sky has it: grey in a storm, not white (cloudColour).
    webgl.uniform4f(uniform(using, "uFog"), 0.86 * fogLight, 0.89 * fogLight, 0.92 * fogLight, view.inside ? 0 : view.fog ?? 0);
  }

  function place(into: Frame, moved?: ArrayLike<number>): Frame {
    const { view } = drawing;
    if (moved) multiplyInto(into.modelView, view.modelView, moved);
    else into.modelView.set(view.modelView);
    // A piece that has turned sees the sun from where it has turned to.
    for (let i = 0; i < 3; i++) {
      into.light[i] = moved
        ? moved[i * 4] * view.light[0] + moved[i * 4 + 1] * view.light[1] + moved[i * 4 + 2] * view.light[2]
        : view.light[i];
    }
    into.poser.pose(positions, drawing.sweep, into.modelView, into.light);
    return into;
  }

  function pass(clear: boolean, shader: WebGLProgram): void {
    const webgl = context;
    const { view, broken } = drawing;
    const hull = frames[0]!;
    for (const chunk of drawn) {
      const material = materials[chunk.material];
      // A part smeared as it spins: a fan's blades only as their smear, over what is behind them; a round part whole, its smear over it.
      const smearing = chunk.spins && hull.poser.smeared.has(chunk.part!) && !loose.has(chunk.part!);
      if (smearing) {
        if (clear && chunk.bladed) continue;
        if (!clear) {
          smear(chunk, shader);
          continue;
        }
      } else if ((material.opacity < 1) === clear) continue;
      const texture = textures[chunk.material];
      webgl.uniform1i(uniform(shader, "uTextured"), texture ? 1 : 0);
      if (texture) webgl.bindTexture(webgl.TEXTURE_2D, texture);
      webgl.uniform3f(uniform(shader, "uColour"), material.colour[0], material.colour[1], material.colour[2]);
      webgl.uniform1f(uniform(shader, "uOpacity"), clear ? 1 : material.opacity * (view.inside ? GLASS_FROM_INSIDE : 1));
      webgl.uniform3f(uniform(shader, "uMin"), chunk.min[0], chunk.min[1], chunk.min[2]);
      webgl.uniform3f(uniform(shader, "uSize"), chunk.size[0], chunk.size[1], chunk.size[2]);
      webgl.uniform2f(uniform(shader, "uUvMin"), chunk.uvMin[0], chunk.uvMin[1]);
      webgl.uniform2f(uniform(shader, "uUvSize"), chunk.uvSize[0], chunk.uvSize[1]);
      webgl.bindVertexArray(chunk.vao);
      const away = chunk.part !== undefined ? loose.get(chunk.part) : undefined;
      if (away !== undefined) {
        if (away) {
          webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, away.modelView);
          webgl.uniform3f(uniform(shader, "uLight"), away.light[0], away.light[1], away.light[2]);
          if (broken) webgl.uniform1i(uniform(shader, "uKeep"), EVERY_PIECE);
          webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
          drawing.calls++;
        }
        continue;
      }
      // Once for all of it that is still together, and once for each piece of it that is off.
      let done = 0;
      for (const piece of broken ? chunk.pieces : ALL_HULL) {
        const through = frames[piece];
        if (!through || done & (1 << piece)) continue;
        const keep = keptOf(chunk.pieces, through);
        done |= keep;
        const moved = chunk.part ? through.poser.posed.get(chunk.part) : undefined;
        const light = moved?.light ?? through.light;
        webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, moved?.modelView ?? through.modelView);
        webgl.uniform3f(uniform(shader, "uLight"), light[0], light[1], light[2]);
        if (broken) webgl.uniform1i(uniform(shader, "uKeep"), allKept(chunk.pieces, keep) ? EVERY_PIECE : keep);
        webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
        drawing.calls++;
      }
    }
  }

  /*
   * A spinning part's smear: the part drawn once for each place it
   * passes through in the frame, each copy letting through some of what
   * is behind it, and a hair nearer than itself, so that over a round
   * part drawn whole each copy is seen on it.
   */
  function smear(chunk: Drawn, shader: WebGLProgram): void {
    const webgl = context;
    const { broken } = drawing;
    const material = materials[chunk.material];
    const texture = textures[chunk.material];
    webgl.uniform1i(uniform(shader, "uTextured"), texture ? 1 : 0);
    if (texture) webgl.bindTexture(webgl.TEXTURE_2D, texture);
    webgl.uniform3f(uniform(shader, "uColour"), material.colour[0], material.colour[1], material.colour[2]);
    webgl.uniform3f(uniform(shader, "uMin"), chunk.min[0], chunk.min[1], chunk.min[2]);
    webgl.uniform3f(uniform(shader, "uSize"), chunk.size[0], chunk.size[1], chunk.size[2]);
    webgl.uniform2f(uniform(shader, "uUvMin"), chunk.uvMin[0], chunk.uvMin[1]);
    webgl.uniform2f(uniform(shader, "uUvSize"), chunk.uvSize[0], chunk.uvSize[1]);
    webgl.bindVertexArray(chunk.vao);
    webgl.depthFunc(webgl.LEQUAL);
    webgl.enable(webgl.POLYGON_OFFSET_FILL);
    webgl.polygonOffset(-1, -2);
    let done = 0;
    for (const piece of broken ? chunk.pieces : ALL_HULL) {
      const through = frames[piece];
      if (!through || done & (1 << piece)) continue;
      const keep = keptOf(chunk.pieces, through);
      done |= keep;
      if (broken) webgl.uniform1i(uniform(shader, "uKeep"), allKept(chunk.pieces, keep) ? EVERY_PIECE : keep);
      const smeared = through.poser.smeared.get(chunk.part!);
      if (smeared) {
        webgl.uniform1f(uniform(shader, "uOpacity"), material.opacity * smeared.opacity);
        for (let i = 0; i < smeared.count; i++) {
          const copy = smeared.copies[i];
          webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, copy.modelView);
          webgl.uniform3f(uniform(shader, "uLight"), copy.light[0], copy.light[1], copy.light[2]);
          webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
          drawing.calls++;
        }
      } else {
        // A piece that has come off and turned its fan away is not smeared: drawn as it is.
        const moved = through.poser.posed.get(chunk.part!);
        const light = moved?.light ?? through.light;
        webgl.uniform1f(uniform(shader, "uOpacity"), material.opacity);
        webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, moved?.modelView ?? through.modelView);
        webgl.uniform3f(uniform(shader, "uLight"), light[0], light[1], light[2]);
        webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
        drawing.calls++;
      }
    }
    webgl.disable(webgl.POLYGON_OFFSET_FILL);
    webgl.depthFunc(webgl.LESS);
  }

  /**
   * The aircraft as `view` sees it, into the viewport set, `width` by
   * `height` pixels, over what is there and with a depth of its own: what
   * `draw` and `drawInset` both draw once they have set the picture up.
   */
  function drawAircraft(view: AircraftView, screens: readonly AircraftScreen[], width: number, height: number): number {
    const webgl = context;
    drawing.view = view;
    drawing.calls = 0;
    const pool = (framePool ??= { hull: blankFrame(), pieces: PIECES.slice(1).map(blankFrame), loose: new Map() });
    // Nearer than anything on the map: over all of it, sorted only against itself.
    webgl.enable(webgl.DEPTH_TEST);
    webgl.depthFunc(webgl.LESS);
    webgl.depthRange(0, 1);
    webgl.depthMask(true);
    webgl.clearDepth(1);
    webgl.clear(webgl.DEPTH_BUFFER_BIT);

    const [near, far] = view.inside ? INSIDE_RANGE : OUTSIDE_RANGE;
    perspectiveInto(projection, view.fov, width / Math.max(height, 1), near, far);
    const off = view.pieces;
    const broken = off !== undefined && ("leftWing" in off || "rightWing" in off || "tail" in off);
    if (broken) torn ??= compile(context, BROKEN + VERTEX, BROKEN + FRAGMENT);
    const shader = broken && torn ? torn : program;
    // A blast lights what is round it for as long as it flashes.
    const glare = view.effects ? blastGlare(view.effects) : 0;
    skyLighting(view.inside ? INSIDE_LIGHTING : OUTSIDE_LIGHTING, view.sunlight, view.daylight, lighting);
    const flash = Math.min(Math.max(view.lightning ?? 0, 0), 1) * (view.inside ? LIGHTNING_INSIDE : LIGHTNING_OUTSIDE);
    drawing.broken = broken;
    drawing.glare = glare;
    drawing.flash = flash;
    drawing.fogLight = 0.4 + 0.6 * Math.min(Math.max(view.daylight ?? 1, 0), 1);
    prepare(shader);
    webgl.activeTexture(webgl.TEXTURE0);

    // The gear's legs and doors, the flaps, slats and spoilers, the ailerons, elevators and rudder, the fans and the flight deck's
    // controls where they are now; the rest as the model has it.
    positions.gear = view.gear ?? 1;
    positions.flaps = view.flaps ?? 0;
    positions.spoilers = view.spoilers ?? 0;
    positions.ailerons = view.ailerons ?? 0;
    positions.elevator = view.elevator ?? 0;
    positions.rudder = view.rudder ?? 0;
    positions.fans = view.fans?.angle ?? 0;
    // Each control of the flight deck as the model has it where not said: none of them moved.
    for (const drive of COCKPIT_DRIVES) positions[drive] = 0;
    if (view.cockpit) Object.assign(positions, cockpitDrives(view.cockpit));
    // The fans smeared from outside; from the seat, where none is seen, not.
    drawing.sweep = view.inside ? 0 : view.fans?.sweep ?? 0;
    const hull = place(pool.hull);
    // Each piece's frame: the hull's while it is on, its own once it is off, none once it is gone.
    frames[0] = hull;
    for (let p = 1; p < PIECES.length; p++) {
      const moved = off?.[PIECES[p] as AircraftPiece];
      frames[p] = moved === undefined ? hull : moved && place(pool.pieces[p - 1], moved);
    }
    // A part that has come off: through its own frame for as long as it is in sight, then through none.
    loose.clear();
    const lost = view.lost;
    if (lost) {
      for (const name in lost) {
        const moved = lost[name];
        if (!moved) {
          loose.set(name, null);
          continue;
        }
        let kept = pool.loose.get(name);
        if (!kept) pool.loose.set(name, (kept = blankFrame()));
        loose.set(name, place(kept, moved));
      }
    }
    if (broken) {
      webgl.uniform3f(uniform(shader, "uBreaks"), BREAKS.wingRoot, BREAKS.tail, BREAKS.ragged);
      webgl.uniform3f(uniform(shader, "uTorn"), "leftWing" in off! ? 1 : 0, "rightWing" in off! ? 1 : 0, "tail" in off! ? 1 : 0);
    }
    // Everything solid, then the screens on it, then the glass over both: from the seat, with the weather on it.
    webgl.disable(webgl.BLEND);
    pass(true, shader);
    if (view.inside) drawScreens(view, screens, projection);
    const onGlass = view.inside && !broken ? view.glass : undefined;
    if (onGlass) glass ??= compile(context, GLASS + VERTEX, GLASS + FRAGMENT);
    const clear = onGlass && glass ? glass : shader;
    prepare(clear);
    if (onGlass && glass) {
      webgl.uniform1f(uniform(glass, "uTime"), onGlass.time);
      webgl.uniform1f(uniform(glass, "uSpeed"), onGlass.speed);
      webgl.uniform1f(uniform(glass, "uWet"), onGlass.wet);
      webgl.uniform1f(uniform(glass, "uHail"), onGlass.hail);
      webgl.uniform1f(uniform(glass, "uCharge"), onGlass.charge);
      webgl.uniform1f(uniform(glass, "uSun"), view.sunlight ?? 1);
      webgl.uniform1f(uniform(glass, "uDay"), view.daylight ?? 1);
      webgl.uniform1f(uniform(glass, "uBolt"), view.lightning ?? 0);
      webgl.uniform1i(uniform(glass, "uScene"), 1);
      webgl.uniform2f(uniform(glass, "uViewport"), width, height);
      webgl.uniform1i(uniform(glass, "uRefract"), behind ? 1 : 0);
      webgl.uniform1i(uniform(glass, "uFine"), onGlass.fine === false ? 0 : 1);
      webgl.uniform1f(uniform(glass, "uFrost"), Math.min(Math.max(onGlass.frost ?? 0, 0), 1));
      webgl.uniform1i(uniform(glass, "uPanes"), windows.count);
      if (windows.count) {
        webgl.uniform4fv(uniform(glass, "uPlane"), windows.planes);
        webgl.uniform3fv(uniform(glass, "uMiddle"), windows.middles);
        webgl.uniform3fv(uniform(glass, "uSpan"), windows.spans);
        webgl.uniform4fv(uniform(glass, "uEdge"), windows.edges);
      }
      if (behind) {
        webgl.activeTexture(webgl.TEXTURE1);
        webgl.bindTexture(webgl.TEXTURE_2D, behind.texture);
        webgl.activeTexture(webgl.TEXTURE0);
      }
    }
    webgl.enable(webgl.BLEND);
    webgl.depthMask(false);
    pass(false, clear);
    // What burns, over the aircraft and behind whatever of it is nearer.
    if (view.effects && (view.effects.fires.length || view.effects.blasts.length)) {
      effects ??= makeEffectsPass(context, (vertex, fragment) => compile(context, vertex, fragment));
      effects.draw(view.effects, view.modelView, projection, view.light, view.inside ? INSIDE_FADE : OUTSIDE_FADE);
      drawing.calls++;
    }
    webgl.depthMask(true);
    webgl.bindVertexArray(null);
    webgl.bindTexture(webgl.TEXTURE_2D, null);
    if (behind) {
      webgl.activeTexture(webgl.TEXTURE1);
      webgl.bindTexture(webgl.TEXTURE_2D, null);
      webgl.activeTexture(webgl.TEXTURE0);
    }
    return drawing.calls;
  }

  return {
    upload,

    draw(view, screens) {
      const webgl = context;
      const width = webgl.drawingBufferWidth;
      const height = webgl.drawingBufferHeight;
      webgl.viewport(0, 0, width, height);
      webgl.disable(webgl.SCISSOR_TEST);
      webgl.disable(webgl.STENCIL_TEST);
      webgl.disable(webgl.CULL_FACE);
      webgl.colorMask(true, true, true, true);

      // The weather on the glass, over the world and under the aircraft.
      webgl.disable(webgl.DEPTH_TEST);
      webgl.enable(webgl.BLEND);
      webgl.blendFunc(webgl.ONE, webgl.ONE_MINUS_SRC_ALPHA);
      webgl.useProgram(veil);
      for (const [colour, strength] of [[cloudColour(view.daylight), view.veil * 0.96], [[1, 1, 1], view.flash * 0.6]] as const) {
        if (strength <= 0.003) continue;
        webgl.uniform4f(uniform(veil, "uColour"), colour[0] * strength, colour[1] * strength, colour[2] * strength, strength);
        webgl.drawArrays(webgl.TRIANGLES, 0, 3);
      }
      if (!drawn.length) return false;
      // From the seat, with water on the glass, the world behind it as it is now, for the water to show bent.
      // And with ice on it, for the ice to scatter.
      const wet = view.inside && ((view.glass?.wet ?? 0) > 0.01 || (view.glass?.frost ?? 0) > 0.01);
      if (wet) copyBehind(width, height);
      // Dry again: its memory back.
      else forgetBehind();
      drawAircraft(view, screens, width, height);
      return true;
    },

    drawInset(view, x, y, width, height) {
      if (!drawn.length || width < 1 || height < 1) return 0;
      const webgl = context;
      // Only the rectangle: what is outside it, the flight's own picture, is left as it is, its depth too.
      webgl.viewport(x, y, width, height);
      webgl.enable(webgl.SCISSOR_TEST);
      webgl.scissor(x, y, width, height);
      webgl.disable(webgl.STENCIL_TEST);
      webgl.disable(webgl.CULL_FACE);
      webgl.colorMask(true, true, true, true);
      const calls = drawAircraft(view.inside ? { ...view, inside: false } : view, [], width, height);
      webgl.disable(webgl.SCISSOR_TEST);
      webgl.viewport(0, 0, webgl.drawingBufferWidth, webgl.drawingBufferHeight);
      return calls;
    },

    dispose() {
      for (const { vao, buffers } of drawn) {
        context.deleteVertexArray(vao);
        for (const buffer of buffers) context.deleteBuffer(buffer);
      }
      for (const texture of [...textures, ...[...screenTextures.values()].map((held) => held.texture)]) if (texture) context.deleteTexture(texture);
      screenTextures.clear();
      for (const buffer of screenBuffers) context.deleteBuffer(buffer);
      context.deleteVertexArray(screenVao);
      for (const each of [program, veil, screen, torn, glass]) if (each) context.deleteProgram(each);
      torn = null;
      glass = null;
      forgetBehind();
      effects?.dispose();
      effects = null;
      drawn = [];
      textures = [];
    },
  };
}
