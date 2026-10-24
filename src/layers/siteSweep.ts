import ImageLayer from "ol/layer/Image";
import ImageCanvasSource from "ol/source/ImageCanvas";
import type { Extent } from "ol/extent";
import type { Size } from "ol/size";
import { rvp6Table } from "../lib/rvp6";
import { velocityTable } from "../colormaps";
import type { Rgba } from "../colormaps";
import type { Sweep } from "../lib/sweep";
import type { Motion } from "../lib/sweepGeometry";
import { EARTH_RADIUS_M, EFFECTIVE_RADIUS_M } from "../lib/sweepGeometry";
import { isDarkBasemap, watchBasemap } from "./casing";

/**
 * One radar's sweep, drawn in its own polar bins: site mode's map.
 *
 * Not tiles. The pyramid stops at zoom 8, where a 250 m bin is under a pixel
 * and a velocity couplet five, and tiling every site's every tilt would
 * resample the very bins a chaser reads. So the sweep is one R8 texture,
 * rays by bins, and a fragment shader maps each screen pixel back to the
 * bin under it: from Mercator to longitude and latitude, to the ground
 * distance and bearing from the site, along the 4/3-earth beam to a slant
 * range, to a bin and a ray, to a byte, to a colour. Storm-relative velocity
 * is the same draw with the storm's motion taken out of each byte before the
 * palette (`lib/sweepGeometry.ts` has the formulas, and the CPU copy the long
 * press reads; the two are held to each other by the unit tests).
 *
 * Raw WebGL2 on a canvas of its own, as the 3D map's raymarch is, handed to
 * OpenLayers through an `ImageCanvas` source: the layer is drawn again when
 * the view settles or the sweep changes, and moved as a picture while the map
 * pans. Above the composites (79 to 81) and below the snow (90). Past the
 * sweep's last bin the map is greyed over, so the radar's reach reads at a
 * glance and nothing out there passes for what it measured.
 *
 * Its context is let go whenever site mode closes, and when its map has been
 * hidden a while (`hiddenMaps.ts` clears every layer's renderer, which this
 * takes as its cue), so a phone holds no second WebGL context for a mode
 * nobody has open. A browser without WebGL2 draws nothing, and the rest
 * of the map draws as ever; a context the browser takes away is replaced
 * by a new one, and the sweep drawn again on it.
 */

const VERTEX = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec4 u_extent;      // the image's Mercator extent: min x, min y, max x, max y
uniform vec2 u_size;        // the image in pixels
uniform vec2 u_site;        // the radar's longitude and latitude, radians
uniform float u_elevation;  // the tilt, radians
uniform vec2 u_range;       // the first bin's start and each bin's length, metres
uniform ivec2 u_shape;      // rays, bins
uniform vec2 u_azimuth;     // the first ray's centre and the step, degrees
uniform int u_mode;         // 0 reflectivity, 1 velocity, 2 storm-relative velocity
uniform vec2 u_motion;      // the storm's speed in m/s and heading in radians, for 2
uniform usampler2D u_bins;  // R8UI, bins wide, rays high
uniform sampler2D u_palette;// 256 x 1
uniform vec4 u_veil;        // premultiplied, over the map past the last bin

out vec4 colour;

const float MERCATOR_RADIUS = 6378137.0;
const float EARTH = ${EARTH_RADIUS_M.toFixed(1)};
const float EFFECTIVE = ${EFFECTIVE_RADIUS_M.toFixed(1)};
const float HALF_PI = 1.5707963267948966;

void main() {
  vec2 merc = mix(u_extent.xy, u_extent.zw, gl_FragCoord.xy / u_size);
  float lon = merc.x / MERCATOR_RADIUS;
  float lat = 2.0 * atan(exp(merc.y / MERCATOR_RADIUS)) - HALF_PI;

  // Ground distance and bearing from the site, on the sphere.
  float dLat = lat - u_site.y;
  float dLon = lon - u_site.x;
  float a = sin(dLat * 0.5) * sin(dLat * 0.5) + cos(u_site.y) * cos(lat) * sin(dLon * 0.5) * sin(dLon * 0.5);
  float ground = 2.0 * EARTH * asin(min(1.0, sqrt(a)));
  float bearing = degrees(atan(sin(dLon) * cos(lat),
    cos(u_site.y) * sin(lat) - sin(u_site.y) * cos(lat) * cos(dLon)));

  // Along the beam on the 4/3 earth.
  float s = ground / EFFECTIVE;
  float slant = EFFECTIVE * sin(s) / cos(u_elevation + s);
  int bin = int(floor((slant - u_range.x) / u_range.y));
  if (slant < 0.0 || bin >= u_shape.y) {
    colour = u_veil;
    return;
  }
  if (bin < 0) discard;
  // mod() on floats: GLSL leaves % of a negative int undefined.
  float steps = round((bearing - u_azimuth.x) / u_azimuth.y);
  int ray = int(mod(steps, float(u_shape.x)));

  int index = int(texelFetch(u_bins, ivec2(bin, ray), 0).r);
  if (u_mode == 2 && index >= 2 && index <= 254) {
    float v = float(index - 128) * 0.5;
    float az = radians(u_azimuth.x + float(ray) * u_azimuth.y);
    float relative = v - u_motion.x * cos(az - u_motion.y);
    index = int(clamp(round(relative / 0.5) + 128.0, 2.0, 254.0));
  }
  vec4 c = texelFetch(u_palette, ivec2(index, 0), 0);
  if (c.a == 0.0) discard;
  colour = vec4(c.rgb * c.a, c.a);
}`;

/** The grey past a sweep's reach, premultiplied, on a light basemap and a dark one. */
const LIGHT_VEIL: Rgba = [96, 100, 108, 140];
const DARK_VEIL: Rgba = [0, 0, 0, 120];

/** What is drawn: the sweep, how, and for SRV, the storm's motion. */
export interface Drawn {
  sweep: Sweep;
  mode: "reflectivity" | "velocity" | "srv";
  motion: Motion | null;
}

/** How long the last draw took, for measuring it on phones. */
export interface DrawStats {
  lastMs: number;
  draws: number;
}

class SweepRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private bins: WebGLTexture | null = null;
  private palette: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private uploaded: Sweep | null = null;
  private paletteKey = "";
  private readonly empty = document.createElement("canvas");
  readonly stats: DrawStats = { lastMs: 0, draws: 0 };

  /** `lost` is told when the browser takes the context away, so the sweep is drawn again on a new one. */
  constructor(private readonly lost: () => void) {
    this.empty.width = 1;
    this.empty.height = 1;
  }

  /** A canvas of `size` with the sweep drawn over `extent`, or an empty one. */
  draw(drawn: Drawn | null, reflectivityPalette: string, veil: Rgba, extent: Extent, size: Size): HTMLCanvasElement {
    if (!drawn || size[0] < 1 || size[1] < 1) return this.empty;
    const started = performance.now();
    const gl = this.context();
    if (!gl || !this.canvas || !this.program) return this.empty;
    const [width, height] = [Math.round(size[0]), Math.round(size[1])];
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.upload(gl, drawn.sweep);
    this.uploadPalette(gl, drawn.sweep.header.encoding === "vrad-u8" ? "velocity" : reflectivityPalette);

    const header = drawn.sweep.header;
    const u = this.uniforms;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform4f(u.u_extent, extent[0], extent[1], extent[2], extent[3]);
    gl.uniform2f(u.u_size, width, height);
    gl.uniform2f(u.u_site, (header.lon * Math.PI) / 180, (header.lat * Math.PI) / 180);
    gl.uniform1f(u.u_elevation, (header.elevation_deg * Math.PI) / 180);
    gl.uniform2f(u.u_range, header.range_start_m, header.range_step_m);
    gl.uniform2i(u.u_shape, header.nrays, header.nbins);
    gl.uniform2f(u.u_azimuth, header.azimuth0_deg, header.azimuth_step_deg);
    const mode = drawn.mode === "reflectivity" ? 0 : drawn.mode === "srv" && drawn.motion ? 2 : 1;
    gl.uniform1i(u.u_mode, mode);
    gl.uniform2f(u.u_motion, drawn.motion?.speedMs ?? 0, ((drawn.motion?.headingDeg ?? 0) * Math.PI) / 180);
    const alpha = veil[3] / 255;
    gl.uniform4f(u.u_veil, (veil[0] / 255) * alpha, (veil[1] / 255) * alpha, (veil[2] / 255) * alpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bins);
    gl.uniform1i(u.u_bins, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.uniform1i(u.u_palette, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.lastMs = performance.now() - started;
    this.stats.draws++;
    return this.canvas;
  }

  /** Let go of the context and everything on it; the next draw builds them again. */
  release() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      gl.deleteTexture(this.bins);
      gl.deleteTexture(this.palette);
      gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.forget();
  }

  /** Drop every handle on the context, whether let go of or taken away. */
  private forget() {
    this.gl = null;
    this.canvas = null;
    this.program = null;
    this.bins = null;
    this.palette = null;
    this.uploaded = null;
    this.paletteKey = "";
  }

  private context(): WebGL2RenderingContext | null {
    if (this.gl) return this.gl;
    const canvas = document.createElement("canvas");
    // Kept, because OpenLayers copies the canvas onto the map after this returns.
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    // Only for the context in use. `release` loses its own on purpose, and
    // the event for that lands after the next radar may have built a new
    // one: taken for that one's, it left every other radar opened blank.
    canvas.addEventListener("webglcontextlost", () => {
      if (canvas !== this.canvas) return;
      this.forget();
      this.lost();
    });
    const program = link(gl);
    if (!program) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle over the whole viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ["u_extent", "u_size", "u_site", "u_elevation", "u_range", "u_shape", "u_azimuth", "u_mode", "u_motion", "u_bins", "u_palette", "u_veil"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.bins = gl.createTexture();
    this.palette = gl.createTexture();
    return gl;
  }

  private upload(gl: WebGL2RenderingContext, sweep: Sweep) {
    if (this.uploaded === sweep) return;
    gl.bindTexture(gl.TEXTURE_2D, this.bins);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, sweep.header.nbins, sweep.header.nrays, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, sweep.bins);
    nearest(gl);
    this.uploaded = sweep;
  }

  private uploadPalette(gl: WebGL2RenderingContext, name: string) {
    if (this.paletteKey === name) return;
    const table: Rgba[] = name === "velocity" ? velocityTable() : rvp6Table(name);
    const bytes = new Uint8Array(256 * 4);
    table.forEach((rgba, i) => bytes.set(rgba, i * 4));
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    nearest(gl);
    this.paletteKey = name;
  }
}

function nearest(gl: WebGL2RenderingContext) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("site sweep shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("site sweep program:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** An image layer that lets go of its WebGL context with its renderer (`hiddenMaps.ts`). */
class SweepImageLayer extends ImageLayer<ImageCanvasSource> {
  constructor(private readonly sweeps: SweepRenderer, source: ImageCanvasSource) {
    super({ source, zIndex: 85, visible: false });
  }

  override clearRenderer(): void {
    super.clearRenderer();
    this.sweeps.release();
  }
}

export interface SiteSweepLayer {
  layer: ImageLayer<ImageCanvasSource>;
  /** Draw this sweep, or nothing. */
  show(drawn: Drawn | null): void;
  /** The reader's reflectivity palette (`rvp6Table`). */
  setPalette(name: string): void;
  /** The map's corner credit while a site is drawn. */
  setAttribution(credit: string | null): void;
  /** Hide it and let go of its context, as when site mode closes. */
  release(): void;
  readonly stats: DrawStats;
}

/** The layer, and the way to put a sweep on it. */
export default function makeSiteSweepLayer(): SiteSweepLayer {
  // Taken away by the browser (too many contexts, a GPU reset): drawn again on a new one.
  const renderer = new SweepRenderer(() => { if (drawn) source.changed(); });
  let drawn: Drawn | null = null;
  let palette = "classic";
  let veil = LIGHT_VEIL;
  const source = new ImageCanvasSource({
    canvasFunction: (extent, _resolution, _pixelRatio, size) => renderer.draw(drawn, palette, veil, extent, size),
    // The viewport, no margin: drawn again when the view settles, and a margin
    // would only be pixels the shader paints for nobody.
    ratio: 1,
    interpolate: false,
  });
  const layer = new SweepImageLayer(renderer, source);
  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK_VEIL : LIGHT_VEIL), (next) => {
    veil = next;
    if (drawn) source.changed();
  });
  return {
    layer,
    stats: renderer.stats,
    show(next) {
      drawn = next;
      layer.setVisible(next !== null);
      source.changed();
    },
    setPalette(name) {
      palette = name;
      if (drawn) source.changed();
    },
    setAttribution(credit) {
      source.setAttributions(credit ? [credit] : undefined);
    },
    release() {
      drawn = null;
      layer.setVisible(false);
      renderer.release();
      source.changed();
    },
  };
}
