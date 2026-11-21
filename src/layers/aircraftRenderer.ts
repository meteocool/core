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
import { BREAKS, cockpitDrives, multiply4, parseModel, pieceOf, PIECES, piecesOf, posedParts, VERTEX_BYTES } from "../lib/studio/flight/model";
import type { AircraftModel, CockpitPose } from "../lib/studio/flight/model";
import { blastGlare, makeEffectsPass } from "./aircraftEffects";
import type { EffectsPass } from "./aircraftEffects";
import { perspective } from "../lib/studio/flight/view";
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

/* The aircraft's two shaders are one text: with BROKEN defined, the one that draws it in pieces. */
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
#ifdef BROKEN
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
#ifdef BROKEN
  vPlace = place.xyz;
  vSeen = seen.xyz;
#endif
  gl_Position = uProjection * seen;
}`;

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
#ifdef BROKEN
in vec3 vPlace;
in vec3 vSeen;
uniform mat4 uModelView;
// The pieces this draw is of, a bit each (hull, left wing, right wing, tail); all four for a mesh that is not cut.
uniform int uKeep;
// Where the wings and the tail come off, and how far a break wanders from its line; metres.
uniform vec3 uBreaks;
// Which breaks are open: the left wing's, the right wing's, the tail's.
uniform vec3 uTorn;
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
  colour = vec4(mix(base.rgb * lit, uFog.rgb, fogged) * alpha, alpha);
}`;

const WHOLE = "#version 300 es\n";
const BROKEN = "#version 300 es\n#define BROKEN\n";
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

/** The cloud's colour on the glass. */
const VEIL_COLOUR: Vec3 = [0.86, 0.89, 0.92];

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
  /**
   * The pieces it has something of, by their places in `PIECES`: a moving
   * part is of one piece, whole; the rest, of every piece its box reaches.
   */
  pieces: number[];
}

/** A piece as one frame draws it: through which model-view, lit from where (in its own frame), and its moving parts where they are. */
interface Frame {
  modelView: Float32Array;
  light: Vec3;
  posed: ReturnType<typeof posedParts>;
}

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
  /** Let go of everything it holds on the GPU. */
  dispose(): void;
}

export function makeAircraftRenderer(context: WebGL2RenderingContext): AircraftRenderer {
  const program = compile(context, WHOLE + VERTEX, WHOLE + FRAGMENT);
  const veil = compile(context, VEIL_VERTEX, VEIL_FRAGMENT);
  const screen = compile(context, WHOLE + SCREEN_VERTEX, WHOLE + FRAGMENT);
  /* Made when first needed, and by most flights never: the shader of an aircraft in pieces, and what burns. */
  let torn: WebGLProgram | null = null;
  let effects: EffectsPass | null = null;
  const screenVao = context.createVertexArray()!;
  let drawn: Drawn[] = [];
  let textures: Array<WebGLTexture | null> = [];
  /* Each picture's texture, by picture: one picture may light several screens, and goes up once. */
  const screenTextures = new Map<HTMLCanvasElement, { texture: WebGLTexture; version: number | undefined; width: number; height: number }>();
  let materials: AircraftModel["materials"] = [];
  let parts: AircraftModel["parts"] = {};
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
        pieces: (chunk.part ? [pieceOf(middle)] : piecesOf(chunk.min, chunk.size)).map((piece) => PIECES.indexOf(piece)),
      };
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function drawScreens(view: AircraftView, screens: readonly AircraftScreen[], projection: number[]): void {
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
      for (const [colour, strength] of [[VEIL_COLOUR, view.veil * 0.96], [[1, 1, 1], view.flash * 0.6]] as const) {
        if (strength <= 0.003) continue;
        webgl.uniform4f(uniform(veil, "uColour"), colour[0] * strength, colour[1] * strength, colour[2] * strength, strength);
        webgl.drawArrays(webgl.TRIANGLES, 0, 3);
      }
      if (!drawn.length) return false;

      // Nearer than anything on the map: over all of it, sorted only against itself.
      webgl.enable(webgl.DEPTH_TEST);
      webgl.depthFunc(webgl.LESS);
      webgl.depthRange(0, 1);
      webgl.depthMask(true);
      webgl.clearDepth(1);
      webgl.clear(webgl.DEPTH_BUFFER_BIT);

      const [near, far] = view.inside ? INSIDE_RANGE : OUTSIDE_RANGE;
      const projection = perspective(view.fov, width / Math.max(height, 1), near, far);
      const off = view.pieces;
      const broken = off !== undefined && PIECES.some((name) => name in off);
      if (broken) torn ??= compile(context, BROKEN + VERTEX, BROKEN + FRAGMENT);
      const shader = broken && torn ? torn : program;
      // A blast lights what is round it for as long as it flashes.
      const glare = view.effects ? blastGlare(view.effects) : 0;
      const [ambient, lit, away] = view.inside ? INSIDE_LIGHTING : OUTSIDE_LIGHTING;
      webgl.useProgram(shader);
      webgl.uniformMatrix4fv(uniform(shader, "uProjection"), false, new Float32Array(projection));
      webgl.uniform3f(uniform(shader, "uLighting"), ambient + 0.55 * glare, lit, away);
      webgl.uniform1i(uniform(shader, "uTexture"), 0);
      webgl.uniform4f(uniform(shader, "uFog"), ...VEIL_COLOUR, view.inside ? 0 : view.fog ?? 0);
      webgl.activeTexture(webgl.TEXTURE0);

      // The gear's legs and doors, the flaps, slats and spoilers, the ailerons, elevators and rudder, and the flight deck's controls
      // where they are now; the rest as the model has it.
      const positions = {
        gear: view.gear ?? 1, flaps: view.flaps ?? 0, spoilers: view.spoilers ?? 0,
        ailerons: view.ailerons ?? 0, elevator: view.elevator ?? 0, rudder: view.rudder ?? 0,
        ...cockpitDrives(view.cockpit),
      };
      const frame = (moved?: ArrayLike<number>): Frame => {
        const modelView = new Float32Array(moved ? multiply4(view.modelView, moved) : view.modelView);
        // A piece that has turned sees the sun from where it has turned to.
        const light = moved
          ? [0, 1, 2].map((i) => moved[i * 4] * view.light[0] + moved[i * 4 + 1] * view.light[1] + moved[i * 4 + 2] * view.light[2]) as Vec3
          : view.light;
        return { modelView, light, posed: posedParts(parts, positions, modelView, light) };
      };
      const hull = frame();
      // Each piece's frame: the hull's while it is on, its own once it is off, none once it is gone.
      const frames = PIECES.map((name): Frame | null => {
        const moved = name === "hull" ? undefined : off?.[name];
        return moved === undefined ? hull : moved && frame(moved);
      });
      // A part that has come off: through its own frame for as long as it is in sight, then through none.
      const loose = new Map(Object.entries(view.lost ?? {}).map(([name, moved]) => [name, moved ? frame(moved) : null]));
      if (broken) {
        webgl.uniform3f(uniform(shader, "uBreaks"), BREAKS.wingRoot, BREAKS.tail, BREAKS.ragged);
        webgl.uniform3f(uniform(shader, "uTorn"), ...(["leftWing", "rightWing", "tail"] as const).map((name) => (off && name in off ? 1 : 0)) as Vec3);
      }
      const pass = (clear: boolean) => {
        for (const chunk of drawn) {
          const material = materials[chunk.material];
          if ((material.opacity < 1) === clear) continue;
          const texture = textures[chunk.material];
          webgl.uniform1i(uniform(shader, "uTextured"), texture ? 1 : 0);
          if (texture) webgl.bindTexture(webgl.TEXTURE_2D, texture);
          webgl.uniform3f(uniform(shader, "uColour"), ...material.colour);
          webgl.uniform1f(uniform(shader, "uOpacity"), clear ? 1 : material.opacity * (view.inside ? GLASS_FROM_INSIDE : 1));
          webgl.uniform3f(uniform(shader, "uMin"), ...chunk.min);
          webgl.uniform3f(uniform(shader, "uSize"), ...chunk.size);
          webgl.uniform2f(uniform(shader, "uUvMin"), ...chunk.uvMin);
          webgl.uniform2f(uniform(shader, "uUvSize"), ...chunk.uvSize);
          webgl.bindVertexArray(chunk.vao);
          const away = chunk.part !== undefined ? loose.get(chunk.part) : undefined;
          if (away !== undefined) {
            if (away) {
              webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, away.modelView);
              webgl.uniform3f(uniform(shader, "uLight"), ...away.light);
              if (broken) webgl.uniform1i(uniform(shader, "uKeep"), EVERY_PIECE);
              webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
            }
            continue;
          }
          // Once for all of it that is still together, and once for each piece of it that is off.
          let done = 0;
          for (const piece of broken ? chunk.pieces : ALL_HULL) {
            const through = frames[piece];
            if (!through || done & (1 << piece)) continue;
            let keep = 0;
            for (const other of chunk.pieces) if (frames[other] === through) keep |= 1 << other;
            done |= keep;
            const moved = chunk.part ? through.posed.get(chunk.part) : undefined;
            webgl.uniformMatrix4fv(uniform(shader, "uModelView"), false, moved?.modelView ?? through.modelView);
            webgl.uniform3f(uniform(shader, "uLight"), ...(moved?.light ?? through.light));
            if (broken) webgl.uniform1i(uniform(shader, "uKeep"), chunk.pieces.every((other) => keep & (1 << other)) ? EVERY_PIECE : keep);
            webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
          }
        }
      };
      // Everything solid, then the screens on it, then the glass over both.
      webgl.disable(webgl.BLEND);
      pass(true);
      if (view.inside) drawScreens(view, screens, projection);
      webgl.useProgram(shader);
      webgl.enable(webgl.BLEND);
      webgl.depthMask(false);
      pass(false);
      // What burns, over the aircraft and behind whatever of it is nearer.
      if (view.effects && (view.effects.fires.length || view.effects.blasts.length)) {
        effects ??= makeEffectsPass(context, (vertex, fragment) => compile(context, vertex, fragment));
        effects.draw(view.effects, view.modelView, projection, view.light, view.inside ? INSIDE_FADE : OUTSIDE_FADE);
      }
      webgl.depthMask(true);
      webgl.bindVertexArray(null);
      webgl.bindTexture(webgl.TEXTURE_2D, null);
      return true;
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
      for (const each of [program, veil, screen, torn]) if (each) context.deleteProgram(each);
      torn = null;
      effects?.dispose();
      effects = null;
      drawn = [];
      textures = [];
    },
  };
}
