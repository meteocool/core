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
 */
import { parseModel, posedParts, VERTEX_BYTES } from "../lib/studio/flight/model";
import type { AircraftModel } from "../lib/studio/flight/model";
import { perspective } from "../lib/studio/flight/view";
import type { Vec3 } from "../lib/studio/flight/view";

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
  /** How far the landing gear is down, 0 up to 1 down; down, as the model has it, where not said. */
  gear?: number;
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

const VERTEX = `#version 300 es
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
void main() {
  vNormal = aNormal;
  vUv = aUv * uUvSize + uUvMin;
  gl_Position = uProjection * uModelView * vec4(aPosition * uSize + uMin, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D uTexture;
uniform bool uTextured;
uniform vec3 uColour;
uniform float uOpacity;
uniform vec3 uLight;
// Ambient, lit side, and a little for the side turned away: no face of an inside is black.
uniform vec3 uLighting;
out vec4 colour;
void main() {
  vec4 base = uTextured ? texture(uTexture, vUv) : vec4(uColour, 1.0);
  float facing = dot(normalize(vNormal), uLight);
  float lit = uLighting.x + uLighting.y * max(facing, 0.0) + uLighting.z * max(-facing, 0.0);
  float alpha = base.a * uOpacity;
  colour = vec4(base.rgb * lit * alpha, alpha);
}`;

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
const OUTSIDE_RANGE: [number, number] = [2, 4000];

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

/** The aircraft's model and its textures, from where they are served; the same ones to every caller. */
export function loadAircraft(base: string) {
  loading ??= (async () => {
    const response = await fetch(`${base}a320.bin`);
    if (!response.ok) throw new Error(`aircraft model: ${response.status}`);
    const model = parseModel(await response.arrayBuffer());
    const images = await Promise.all(model.materials.map(async ({ texture }) => {
      if (!texture) return null;
      const file = await fetch(`${base}${texture}`);
      if (!file.ok) return null;
      return createImageBitmap(await file.blob(), { premultiplyAlpha: "none" });
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
  /** The gear's part it belongs to, which moves; see `posedParts`. */
  part?: string;
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

const SCREEN_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform vec3 uCorners[4];
uniform vec4 uPart;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = vec3(0.0, 0.0, 1.0);
  vUv = mix(uPart.xy, uPart.zw, aUv);
  // The first coordinate counts the corner, one step of 65535 each.
  gl_Position = uProjection * uModelView * vec4(uCorners[int(aPosition.x * 65535.0 + 0.5)], 1.0);
}`;

/** What draws the aircraft into one WebGL picture. */
export interface AircraftRenderer {
  /** Hand over the model, once it is loaded. */
  upload(model: AircraftModel, images: Array<ImageBitmap | null>): void;
  /** Draw the aircraft as `view` sees it, over whatever is in the picture, with `screens` lit in its cockpit. */
  draw(view: AircraftView, screens: readonly AircraftScreen[]): void;
  /** Let go of everything it holds on the GPU. */
  dispose(): void;
}

export function makeAircraftRenderer(context: WebGL2RenderingContext): AircraftRenderer {
  const program = compile(context, VERTEX, FRAGMENT);
  const veil = compile(context, VEIL_VERTEX, VEIL_FRAGMENT);
  const screen = compile(context, SCREEN_VERTEX, FRAGMENT);
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
      return {
        vao, buffers: [vertices, indices], count: chunk.indices.length, material: chunk.material,
        min: chunk.min, size: chunk.size, uvMin: chunk.uvMin, uvSize: chunk.uvSize, part: chunk.part,
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
      if (!drawn.length) return;

      // Nearer than anything on the map: over all of it, sorted only against itself.
      webgl.enable(webgl.DEPTH_TEST);
      webgl.depthFunc(webgl.LESS);
      webgl.depthRange(0, 1);
      webgl.depthMask(true);
      webgl.clearDepth(1);
      webgl.clear(webgl.DEPTH_BUFFER_BIT);

      const [near, far] = view.inside ? INSIDE_RANGE : OUTSIDE_RANGE;
      const projection = perspective(view.fov, width / Math.max(height, 1), near, far);
      webgl.useProgram(program);
      webgl.uniformMatrix4fv(uniform(program, "uModelView"), false, new Float32Array(view.modelView));
      webgl.uniformMatrix4fv(uniform(program, "uProjection"), false, new Float32Array(projection));
      webgl.uniform3f(uniform(program, "uLight"), ...view.light);
      webgl.uniform3f(uniform(program, "uLighting"), ...(view.inside ? INSIDE_LIGHTING : OUTSIDE_LIGHTING));
      webgl.uniform1i(uniform(program, "uTexture"), 0);
      webgl.activeTexture(webgl.TEXTURE0);

      // The gear's legs and doors where they are now; the rest as the model has it.
      const still = new Float32Array(view.modelView);
      const posed = posedParts(parts, view.gear ?? 1, view.modelView, view.light);
      const pass = (clear: boolean) => {
        for (const chunk of drawn) {
          const material = materials[chunk.material];
          if ((material.opacity < 1) === clear) continue;
          const moved = chunk.part ? posed.get(chunk.part) : undefined;
          webgl.uniformMatrix4fv(uniform(program, "uModelView"), false, moved?.modelView ?? still);
          webgl.uniform3f(uniform(program, "uLight"), ...(moved?.light ?? view.light));
          const texture = textures[chunk.material];
          webgl.uniform1i(uniform(program, "uTextured"), texture ? 1 : 0);
          if (texture) webgl.bindTexture(webgl.TEXTURE_2D, texture);
          webgl.uniform3f(uniform(program, "uColour"), ...material.colour);
          webgl.uniform1f(uniform(program, "uOpacity"), clear ? 1 : material.opacity * (view.inside ? GLASS_FROM_INSIDE : 1));
          webgl.uniform3f(uniform(program, "uMin"), ...chunk.min);
          webgl.uniform3f(uniform(program, "uSize"), ...chunk.size);
          webgl.uniform2f(uniform(program, "uUvMin"), ...chunk.uvMin);
          webgl.uniform2f(uniform(program, "uUvSize"), ...chunk.uvSize);
          webgl.bindVertexArray(chunk.vao);
          webgl.drawElements(webgl.TRIANGLES, chunk.count, webgl.UNSIGNED_SHORT, 0);
        }
      };
      // Everything solid, then the screens on it, then the glass over both.
      webgl.disable(webgl.BLEND);
      pass(true);
      if (view.inside) drawScreens(view, screens, projection);
      webgl.useProgram(program);
      webgl.enable(webgl.BLEND);
      webgl.depthMask(false);
      pass(false);
      webgl.depthMask(true);
      webgl.bindVertexArray(null);
      webgl.bindTexture(webgl.TEXTURE_2D, null);
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
      for (const each of [program, veil, screen]) context.deleteProgram(each);
      drawn = [];
      textures = [];
    },
  };
}
