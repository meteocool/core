import Layer from "ol/layer/Layer";
import LayerRenderer from "ol/renderer/Layer";
import View from "ol/View";
import ViewHint from "ol/ViewHint";
import type Map from "ol/Map";
import type { FrameState } from "ol/Map";
import type { ViewStateLayerStateExtent } from "ol/View";
import { getIntersection, intersects, isEmpty } from "ol/extent";
import type { Extent } from "ol/extent";
import { decodedTiles, loadStoredTile, onFramesForgotten, previews } from "./valueTiles";
import type ValueTileSource from "./valueTiles";
import type { TileHolder, TileJob, ValueFrame } from "./valueTiles";
import type { DrawingOptions, Look, RadarDrawing } from "./radarDrawing";
import { BLANK } from "../lib/decodedTiles";
import type { PreviewPiece } from "../lib/previewTiles";
import { GpuTiles } from "../lib/gpuTiles";
import type { GpuTile } from "../lib/gpuTiles";
import { FrameSwitch, ancestorTile, childTiles, settled } from "../lib/frameSwitch";
import type { TileCoord } from "../lib/frameSwitch";
import { frameTextureBytes, uploadsPerFrame } from "../lib/gpuBudget";
import { IDLE_AFTER_MS } from "../lib/idleLayers";
import { onRetry, radarTileOutcome, tileArrived } from "../lib/tileStatus";
import { valueTable } from "../lib/rvp6";
import type { Ink } from "../lib/rvp6";

/**
 * Every radar source of the flat map, drawn by one layer from its own WebGL2
 * context: DWD's frames, each network's, the products of all of theirs, the
 * nowcasts.
 *
 * They used to be a dozen OpenLayers WebGL tile layers, re-pointed at the
 * next frame on every step of playback. Each then asked for that frame's
 * tiles one by one and drew each as it landed, the last frame's standing in
 * for the rest: half of one time and half of another, coarse squares where
 * nothing stood in, and on a phone the tile caches turned over every loop.
 * Each also kept a render target and a depth buffer the size of the screen,
 * 15 MB at an iPhone's 3x, beside its own cache of textures.
 *
 * Here each source is a slot (`RadarSlot`) with the frame it shows and the
 * frame it is asked for (lib/frameSwitch.ts). A slot moves to the frame asked
 * for only once every tile of it the view needs is on the GPU, uploading any
 * decoded since (lib/decodedTiles.ts), so it changes whole, in one draw;
 * until then the frame before stays whole. The tiles are textures of a byte
 * a pixel (two at the antialiased edge of a network's ground, the second its
 * coverage), kept by key in one budget of bytes (lib/gpuTiles.ts), so a loop
 * played once stays on the GPU on a desktop and a window of it ahead of the
 * needle on a phone. The frames coming up are uploaded a few tiles an
 * animation frame while nothing else happens (`setUpcoming`), so a step of
 * playback uploads nothing. Playing, each step fades from the frame before in
 * value, before the palette: a cell moves through the intensities between.
 *
 * A hand on the timeline moves through frames faster than any of that: a
 * frame not yet whole is then shown at once from its coarse preview where
 * there is one (lib/previewTiles.ts), a part of a tile a few zooms up kept
 * for every frame of the timeline, blurred rather than of another time, and
 * each tile of it replaces the blur as it comes. Its tiles are asked for
 * only once the needle has rested on it for `REST_MS`, so that the frames
 * it only passed over are not in the way of the one it stopped on.
 *
 * While the map is being zoomed or panned, a frame is moved to on less: a
 * preview that covers only part of a tile will do, as the ground at the
 * edges is new to every frame alike, and playback is not held for tiles
 * meanwhile (lib/playbackGate.ts); so will the frame's own tiles of another
 * zoom, coarser or finer. A tile missing is drawn from the frame's own
 * coarser tiles before its preview, as those are sharper: zoomed into a
 * loop that has played, each step is its tiles from the zoom before.
 *
 * A source hidden on a step (a network's observations, where the forecast
 * begins) is not taken off at once either, while another comes in on the
 * same step (its nowcast): the one stays as it was and the other draws
 * nothing until it is whole or previewed, and then they change places in
 * one draw. Hidden at once, the ground between them stood empty for as long
 * as the newcomer's tiles took. Not for longer than `LINGER_MS`; after that
 * the newcomer is drawn as it comes.
 *
 * A tile's decoded bytes are not let go once it is uploaded, on a phone
 * either: the decoded tiles are bounded by their bytes whatever they hold,
 * so letting an uploaded tile's go would not lower that, only fill the room
 * with frames further ahead, decoded sooner and let go sooner. Played and
 * zoomed through in a simulated iPhone's web view, the content process held
 * no more than it had with the tile layers, and the GPU half as much
 * (November 2026).
 *
 * The palette is a 256-entry table on the GPU, built from the same tables as
 * the tile layers' styles (`valueTable`): a palette change reloads nothing.
 *
 * Which tiles a slot needs, and what each is keyed by, is its
 * `ValueTileSource`'s to say, exactly as for a tile layer, so the frames
 * decoded ahead of playback and the tiles waited for are the same ones;
 * every tile is loaded through `loadStoredTile`. Drawn above the basemap at
 * 80, the old layers' place, below the site sweep at 85. While any tile of
 * a frame shown or asked for is still loading, the map is not complete
 * (`rendercomplete`), which is what a screenshot waits on.
 *
 * Its textures and context are let go when its map has been hidden a while
 * (lib/hiddenMaps.ts clears every renderer), after it has drawn nothing for
 * `IDLE_AFTER_MS`, and when the 3D map opens (`dropEarlierFrames`); closing
 * the player lets go of every texture but those on screen. All are built
 * again on the next draw. A context the browser takes away is replaced.
 */

/**
 * How long a step of playback fades from the frame before, in milliseconds:
 * the whole of the player's 450 ms a frame, so the picture is always on its
 * way from one frame to the next rather than resting on each. The layer
 * redraws every animation frame while it fades, so while playing it draws
 * continuously. 0 cuts.
 */
export const CROSSFADE_MS = 450;

/** How many tiles a layer loads at once for the frames it draws: OpenLayers' own queue had sixteen. */
const MAX_LOADING = 8;

/**
 * How long a frame has to have been asked for before the tiles its preview
 * stands in for are loaded: longer than a hand moving along the timeline
 * stays on a step, shorter than anyone notices on the step it stops on.
 */
export const REST_MS = 80;

/**
 * How many zooms up a missing tile is drawn from the frame's own coarser
 * tiles where it has no preview: far enough that a loop played at one zoom
 * still shows, blurred, three or four zooms in.
 */
const ANCESTOR_REACH = 4;

/**
 * The longest a source hidden on a step stays drawn for the ones coming in
 * on it to be whole. Long, as an empty map is worse than one a step behind,
 * which is all any other source is while its next frame loads; but not for
 * ever, should what comes in never be whole.
 */
export const LINGER_MS = 5000;

/** How long to wait before drawing again while the context is lost. */
const CONTEXT_RETRY_MS = 1000;

/** What one tile is on the GPU. */
interface TileTexture {
  texture: WebGLTexture;
  /** One, values; two, values and the coverage the cut left of each pixel. */
  bands: number;
}

/** What the layer has done, for measuring it. */
export interface FrameStats {
  /** Draws of the layer. */
  renders: number;
  /** Slots drawn, a draw each. */
  slotDraws: number;
  /** Slots drawn with tiles of two frames other than a fade's: none, by design. */
  mixed: number;
  /** Frames switched to, how many of those faded, and how many were shown from their preview first. */
  switches: number;
  fades: number;
  previewSwitches: number;
  /** Tiles uploaded: in all, ahead of their frame, and in a draw that then switched to their frame. */
  uploads: number;
  preUploads: number;
  switchUploads: number;
  /** Tiles the layer loaded itself, and those that failed. */
  loads: number;
  failed: number;
}

/** One rectangle of a tile to draw: where, from which texture's part, faded from which. */
interface DrawItem {
  slot: RadarSlot;
  /** The ground drawn, in map units. */
  region: Extent;
  /** The ground the texture covers, in map units. */
  covers: Extent;
  b: GpuTile<TileTexture>;
  /** The frame faded from, the same tile; null when not fading. */
  a: GpuTile<TileTexture> | null;
  t: number;
  /** A preview, stretched over many pixels of the screen: drawn smoothed. */
  smooth: boolean;
}

const VERTEX = `#version 300 es
in vec2 a_unit;
uniform vec2 u_origin;  // the region's south-west corner, clip space
uniform vec2 u_east;    // from there to its south-east corner
uniform vec2 u_north;   // from there to its north-west corner
uniform vec4 u_tex;     // the texture's west, south, east and north edges of the region
out vec2 v_tex;
void main() {
  v_tex = vec2(mix(u_tex.x, u_tex.z, a_unit.x), mix(u_tex.y, u_tex.w, a_unit.y));
  gl_Position = vec4(u_origin + u_east * a_unit.x + u_north * a_unit.y, 0.0, 1.0);
}`;

/** `blendTexel` in lib/frameSwitch.ts, on the GPU. */
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_a;      // the frame faded from
uniform sampler2D u_b;      // the frame shown
uniform sampler2D u_lut;    // 256 x 1, the palette
uniform float u_t;          // how far the fade has come; 1 for none
uniform float u_opacity;
uniform bool u_coverage;    // whether the shown frame's tile has its coverage as a second band
uniform bool u_smooth;      // a preview: its four nearest texels weighed, not the nearest taken
in vec2 v_tex;
out vec4 colour;

vec4 lookUp(float value) {
  return texelFetch(u_lut, ivec2(int(value), 0), 0);
}

// The texture between its texels, by hand: its own filter stays nearest.
vec4 between(sampler2D tiles, vec2 at) {
  vec2 size = vec2(textureSize(tiles, 0));
  vec2 pixel = at * size - 0.5;
  ivec2 corner = ivec2(floor(pixel));
  vec2 f = pixel - floor(pixel);
  ivec2 last = ivec2(size) - 1;
  vec4 nw = texelFetch(tiles, clamp(corner, ivec2(0), last), 0);
  vec4 ne = texelFetch(tiles, clamp(corner + ivec2(1, 0), ivec2(0), last), 0);
  vec4 sw = texelFetch(tiles, clamp(corner + ivec2(0, 1), ivec2(0), last), 0);
  vec4 se = texelFetch(tiles, clamp(corner + ivec2(1, 1), ivec2(0), last), 0);
  return mix(mix(nw, ne, f.x), mix(sw, se, f.x), f.y);
}

void main() {
  vec4 texel = u_smooth ? between(u_b, v_tex) : texture(u_b, v_tex);
  float b = floor(texel.r * 255.0 + 0.5);
  vec4 c = lookUp(b);
  if (u_t < 1.0) {
    float a = floor(texture(u_a, v_tex).r * 255.0 + 0.5);
    vec4 from = lookUp(a);
    if (from.a > 0.0 && c.a > 0.0) c = lookUp(floor(a + (b - a) * u_t + 0.5));
    else if (from.a > 0.0) c = vec4(from.rgb, from.a * (1.0 - u_t));
    else c.a *= u_t;
  }
  float alpha = c.a * (u_coverage ? texel.g : 1.0) * u_opacity;
  if (alpha <= 0.0) discard;
  colour = vec4(c.rgb * alpha, alpha);
}`;

const UNIFORMS = ["u_origin", "u_east", "u_north", "u_tex", "u_a", "u_b", "u_lut", "u_t", "u_opacity", "u_coverage", "u_smooth"] as const;

let webgl2: boolean | undefined;

/** Whether this browser hands out a WebGL2 context: asked once, on a canvas let go at once. */
export function webgl2Supported(): boolean {
  if (webgl2 === undefined) {
    const gl = typeof document === "undefined" ? null : document.createElement("canvas").getContext("webgl2");
    webgl2 = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webgl2;
}

/** A palette's table as a 256 x 1 texture's bytes. */
function tableBytes(encoding: string, palette: string, ink: Ink | null): Uint8Array {
  const bytes = new Uint8Array(256 * 4);
  valueTable(encoding, palette, ink).forEach((rgba, i) => bytes.set(rgba, i * 4));
  return bytes;
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
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.warn("radar frames shader:", gl.getShaderInfoLog(shader));
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
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (!gl.isContextLost()) console.warn("radar frames program:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/**
 * One radar source as the frame layer draws it: in place of an OpenLayers
 * layer of its own, with the same source, order, extent, opacity and look.
 */
export class RadarSlot implements RadarDrawing {
  readonly frames = new FrameSwitch<ValueFrame>();

  readonly source: ValueTileSource;

  readonly order: number;

  readonly extent: Extent | undefined;

  visible = true;

  opacity: number;

  encoding: string;

  palette: string;

  ink: Ink | null;

  /** When the frame asked for was last another one, in the map's clock. */
  askedAt = 0;

  /** Hidden, but drawn as it was until what comes in on the same step is whole. */
  lingering = false;

  /** When it was hidden, in the map's clock. */
  hiddenAt = 0;

  private gone = false;

  private readonly owner: RadarFrameLayer;

  constructor(owner: RadarFrameLayer, source: ValueTileSource, options: DrawingOptions) {
    this.owner = owner;
    this.source = source;
    this.order = options.order;
    this.extent = options.extent;
    this.opacity = options.opacity;
    this.encoding = options.encoding;
    this.palette = options.palette;
    this.ink = options.ink;
    source.holder = () => owner.residency;
    source.onFrame = (frame) => {
      if (frame.key !== this.frames.wanted?.key) this.askedAt = Date.now();
      this.frames.want(frame);
      owner.changed();
    };
    this.frames.want(source.currentFrame());
    // Made on the step it first has a frame for: whole, where another stands in for it till then.
    this.frames.wait();
    this.askedAt = Date.now();
  }

  /** What its palette table is kept under. */
  get look(): string {
    return `${this.encoding}|${this.palette}|${this.ink ?? ""}`;
  }

  setOpacity(opacity: number) {
    if (opacity === this.opacity) return;
    this.opacity = opacity;
    this.owner.changed();
  }

  getOpacity(): number {
    return this.opacity;
  }

  /**
   * Hidden, it is drawn as it was until the next draw finds nothing coming
   * in for it to stand in for, or what comes in whole (`lingering`). Shown
   * again, it starts from nothing and waits to be whole while another
   * stands in for it; with none, it is drawn as its tiles come.
   */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      if (this.frames.shown) {
        this.lingering = true;
        this.hiddenAt = Date.now();
      } else {
        this.frames.hide();
      }
    } else if (this.lingering) {
      // Back before it was gone: it carries on from the frame it shows.
      this.lingering = false;
    } else {
      this.frames.wait();
      this.askedAt = Date.now();
    }
    this.owner.changed();
  }

  /** Gone from the picture: a hidden source that lingered. */
  vanish() {
    this.lingering = false;
    this.frames.hide();
  }

  setLook(encoding: string, palette: string, ink: Ink | null) {
    if (encoding === this.encoding && palette === this.palette && ink === this.ink) return;
    this.encoding = encoding;
    this.palette = palette;
    this.ink = ink;
    this.owner.changed();
  }

  getLook(): Look {
    return { encoding: this.encoding, palette: this.palette, ink: this.ink };
  }

  getExtent(): Extent | undefined {
    return this.extent;
  }

  get disposed(): boolean {
    return this.gone;
  }

  destroy() {
    this.gone = true;
    this.lingering = false;
    this.source.onFrame = null;
    this.owner.remove(this);
  }
}

/** The layer's WebGL2 context, its textures, and the draw. */
class FramesRenderer extends LayerRenderer<RadarFrameLayer> {
  /** Every tile on the GPU, by its job's key. */
  readonly tiles: GpuTiles<TileTexture>;

  private canvas: HTMLCanvasElement | null = null;

  private gl: WebGL2RenderingContext | null = null;

  private program: WebGLProgram | null = null;

  private uniforms: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {};

  private quad: WebGLVertexArrayObject | null = null;

  private buffer: WebGLBuffer | null = null;

  /** One texel of 0, drawn for a blank. */
  private blank: WebGLTexture | null = null;

  private readonly luts = new globalThis.Map<string, WebGLTexture>();

  private retry: ReturnType<typeof setTimeout> | null = null;

  private items: DrawItem[] = [];

  /** Tiles uploaded for frames asked for, counted so that a switch can say how many it waited on. */
  private pendingUploads = 0;

  /** How many slots the last draw left on another frame than the one asked for. */
  behind = 0;

  constructor(layer: RadarFrameLayer) {
    super(layer);
    this.tiles = new GpuTiles(frameTextureBytes(), ({ texture }) => {
      if (this.gl && !this.gl.isContextLost()) this.gl.deleteTexture(texture);
    });
    this.tiles.retain(layer.retainedKeys());
  }

  /** Whether a tile is on the GPU, or known to draw nothing. */
  holds(key: string): boolean {
    return this.tiles.has(key);
  }

  /** Whether there is a context to upload to. */
  get live(): boolean {
    return this.gl !== null && !this.gl.isContextLost();
  }

  /** Put a tile on the GPU: a texture of a byte or two a pixel, or for a blank, nothing. */
  upload(job: TileJob, tile: Uint8Array | typeof BLANK): void {
    const gl = this.gl;
    const pixels = job.size * job.size;
    const bands = tile === BLANK ? 0 : tile.byteLength / pixels;
    if (tile === BLANK || (bands !== 1 && bands !== 2)) {
      this.tiles.put(job.key, BLANK, 0);
      return;
    }
    const texture = gl?.createTexture();
    if (!gl || !texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const [internal, format] = bands === 2 ? [gl.RG8, gl.RG] : [gl.R8, gl.RED];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, job.size, job.size, 0, format, gl.UNSIGNED_BYTE, tile);
    nearest(gl);
    this.tiles.put(job.key, { texture, bands }, tile.byteLength);
    this.getLayer().stats.uploads += 1;
  }

  override prepareFrame(frameState: FrameState): boolean {
    const layer = this.getLayer();
    this.items = [];
    this.behind = 0;
    this.tiles.unpinAll();
    const slots = layer.slots.filter((slot) => slot.visible && slot.frames.wanted && this.inView(slot, frameState));
    // Hidden sources still drawn: not those out of sight, which stand in for nothing.
    for (const slot of layer.slots) if (slot.lingering && (!slot.frames.shown || !this.inView(slot, frameState))) slot.vanish();
    const lingerers = layer.slots.filter((slot) => slot.lingering);
    const overdue = lingerers.some((slot) => frameState.time - slot.hiddenAt > LINGER_MS);
    // Nothing stands in for a source coming in: it is drawn as its tiles come.
    if (!lingerers.length || overdue) for (const slot of slots) slot.frames.release();
    if ((!slots.length && !lingerers.length) || !this.context()) {
      this.ready = true;
      return false;
    }
    let loading = false;
    for (const slot of slots) loading = this.plan(slot, frameState) || loading;
    if (lingerers.length) {
      if (overdue || !slots.some((slot) => slot.frames.waiting)) {
        // Every source that came in is on screen: the hidden ones go in the same draw.
        for (const slot of lingerers) slot.vanish();
      } else {
        for (const slot of lingerers) this.plan(slot, frameState, true);
        loading = true;
        layer.drawAt(Math.min(...lingerers.map((slot) => slot.hiddenAt)) + LINGER_MS + 1);
        // Drawn in the layer's order, whichever was planned first.
        const order = new globalThis.Map(layer.slots.map((slot, index) => [slot, index]));
        this.items.sort((p, q) => order.get(p.slot)! - order.get(q.slot)!);
      }
    }
    layer.arrived.clear();
    this.ready = !loading;
    return true;
  }

  override renderFrame(frameState: FrameState): HTMLElement {
    const gl = this.gl!;
    const canvas = this.canvas!;
    const layer = this.getLayer();
    layer.stats.renders += 1;
    const [width, height] = frameState.size;
    const pixelWidth = Math.round(width * frameState.pixelRatio);
    const pixelHeight = Math.round(height * frameState.pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.items.length) return canvas;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.quad);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = this.uniforms;
    gl.uniform1i(u.u_a!, 0);
    gl.uniform1i(u.u_b!, 1);
    gl.uniform1i(u.u_lut!, 2);
    const layerOpacity = frameState.layerStatesArray[frameState.layerIndex]?.opacity ?? 1;
    // Map units to clip space: OpenLayers' map units to CSS pixels, then to -1..1, y up.
    const [ta, tb, tc, td, te, tf] = frameState.coordinateToPixelTransform;
    const clip = (x: number, y: number): [number, number] => [
      ((ta * x + tc * y + te) / width) * 2 - 1,
      1 - ((tb * x + td * y + tf) / height) * 2,
    ];
    for (const item of this.items) {
      const { region, covers } = item;
      const [ox, oy] = clip(region[0], region[1]);
      const [ex, ey] = clip(region[2], region[1]);
      const [nx, ny] = clip(region[0], region[3]);
      gl.uniform2f(u.u_origin!, ox, oy);
      gl.uniform2f(u.u_east!, ex - ox, ey - oy);
      gl.uniform2f(u.u_north!, nx - ox, ny - oy);
      const w = covers[2] - covers[0];
      const h = covers[3] - covers[1];
      // A texture's first row is its tile's northern edge.
      gl.uniform4f(u.u_tex!,
        (region[0] - covers[0]) / w, (covers[3] - region[1]) / h, (region[2] - covers[0]) / w, (covers[3] - region[3]) / h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textureOf(item.a ?? BLANK));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.textureOf(item.b));
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.lut(item.slot));
      gl.uniform1f(u.u_t!, item.a === null ? 1 : item.t);
      gl.uniform1f(u.u_opacity!, item.slot.opacity * layerOpacity);
      gl.uniform1i(u.u_coverage!, item.b !== BLANK && item.b.bands === 2 ? 1 : 0);
      gl.uniform1i(u.u_smooth!, item.smooth ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    return canvas;
  }

  /** Whether a slot's rectangle meets the view. */
  private inView(slot: RadarSlot, frameState: FrameState): boolean {
    return !slot.extent || intersects(slot.extent, frameState.extent!);
  }

  /**
   * What a slot draws this time: its frame asked for, switched to once every
   * tile of it in view is ready or its preview covers the rest, else the
   * frame it shows; each missing tile from a coarser one of the same frame,
   * its preview or finer ones. True while any tile of either is still
   * loading. With `drawOnly`, the frame it shows as it is, nothing asked
   * for: a hidden source standing in.
   */
  private plan(slot: RadarSlot, frameState: FrameState, drawOnly = false): boolean {
    const layer = this.getLayer();
    const grid = slot.source.getTileGrid()!;
    const z = grid.getZForResolution(frameState.viewState.resolution, slot.source.zDirection);
    let extent = getIntersection(frameState.extent!, grid.getExtent());
    if (slot.extent) extent = getIntersection(extent, slot.extent);
    if (isEmpty(extent)) {
      // Nothing of it to draw here: nothing to wait for either.
      slot.frames.release();
      return false;
    }
    const range = grid.getTileRangeForExtentAndZ(extent, z);
    const [cx, cy] = frameState.viewState.center;
    const coords: Array<TileCoord & { covers: Extent }> = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) coords.push({ z, x, y, covers: grid.getTileCoordExtent([z, x, y]) });
    }
    // Nearest the middle first: those are loaded first.
    const away = (e: Extent) => Math.hypot((e[0] + e[2]) / 2 - cx, (e[1] + e[3]) / 2 - cy);
    coords.sort((p, q) => away(p.covers) - away(q.covers));

    let loading = false;
    const { frames } = slot;
    // Zoomed or panned right now: the ground in view is not what any frame was loaded for.
    const moving = Boolean(frameState.viewHints[ViewHint.ANIMATING] || frameState.viewHints[ViewHint.INTERACTING]);
    if (frames.pending && !drawOnly) {
      const wanted = frames.wanted!;
      const uploaded = this.pendingUploads;
      const jobs = coords.map(({ z: tz, x, y }) => wanted.job(tz, x, y));
      // Every tile decoded goes up now.
      for (const job of jobs) this.resolve(job, true, false);
      const ready = (job: TileJob) => this.residentOf(job) !== undefined || layer.failed.has(job.key);
      if (settled(jobs, ready)) {
        const fade = layer.fading && frames.shown !== null;
        frames.settle(frameState.time, fade);
        layer.stats.switches += 1;
        if (fade) layer.stats.fades += 1;
        layer.stats.switchUploads += this.pendingUploads - uploaded;
      } else if (settled(coords, (coord) => ready(wanted.job(coord.z, coord.x, coord.y))
        || this.previewOf(wanted, coord, getIntersection(coord.covers, extent), moving) !== undefined
        || (moving && this.standsIn(wanted, coord, grid.getMinZoom(), grid.getMaxZoom())))) {
        // Blurred, but of the time asked for: its tiles replace the preview as they come.
        frames.settle(frameState.time, false);
        layer.stats.switches += 1;
        layer.stats.previewSwitches += 1;
        loading = true;
      } else {
        // Nothing to show of it yet: every tile is asked for.
        for (const job of jobs) this.resolve(job, true);
        this.behind += 1;
        loading = true;
      }
    }
    const shown = frames.shown;
    if (!shown) return loading;
    const t = frames.fade(frameState.time, CROSSFADE_MS);
    const from = t < 1 ? frames.from : null;
    if (from) frameState.animate = true;

    const drawnFrames = new Set<string>();
    const resident = (tile: TileCoord) => this.residentOf(shown.job(tile.z, tile.x, tile.y)) !== undefined;
    const add = (region: Extent, covers: Extent, b: GpuTile<TileTexture>, a: GpuTile<TileTexture> | null, smooth = false) => {
      if (b === BLANK && (a === null || a === BLANK)) return;
      this.items.push({ slot, region, covers, b, a, t, smooth });
      drawnFrames.add(shown.key);
    };
    // While another frame is on its way only that one is loaded: the frame
    // shown fills the ground it has not got from coarser tiles until then.
    const asking = !frames.pending && !drawOnly;
    // A frame the needle may only be passing over: its preview stands in, and its tiles wait.
    const rested = frameState.time - slot.askedAt >= REST_MS;
    for (const coord of coords) {
      const region = getIntersection(coord.covers, extent);
      const job = shown.job(coord.z, coord.x, coord.y);
      const tile = this.resolve(job, false, false);
      if (tile !== undefined) {
        const a = from ? this.residentOf(from.job(coord.z, coord.x, coord.y)) ?? null : null;
        add(region, coord.covers, tile, a);
        continue;
      }
      const failed = layer.failed.has(job.key);
      if (!failed) loading = true;
      const preview = failed ? undefined : this.previewOf(shown, coord, region);
      // A preview cut for the view before this one: what it has of this ground.
      const part = preview || failed ? undefined : this.previewOf(shown, coord, region, true);
      if (asking && (rested || !preview)) layer.request(job);
      else if (asking) layer.drawAt(slot.askedAt + REST_MS);
      // The frame's own tiles before its preview, as far up as the preview is coarser than.
      const above = preview ?? part;
      const up = ancestorTile(coord, grid.getMinZoom(), resident, above ? Math.max(2, coord.z - above.z - 1) : ANCESTOR_REACH);
      if (up) {
        add(region, grid.getTileCoordExtent([up.z, up.x, up.y]), this.residentOf(shown.job(up.z, up.x, up.y))!, null);
        continue;
      }
      if (preview) {
        add(region, preview.covers, preview.tile, null, true);
        continue;
      }
      const children = childTiles(coord, grid.getMaxZoom(), resident);
      for (const child of children) {
        const covers = grid.getTileCoordExtent([child.z, child.x, child.y]);
        add(getIntersection(covers, extent), covers, this.residentOf(shown.job(child.z, child.x, child.y))!, null);
      }
      if (!children.length && part) add(getIntersection(region, part.covers), part.covers, part.tile, null, true);
    }
    if (drawnFrames.size) layer.stats.slotDraws += 1;
    if (drawnFrames.size > 1) layer.stats.mixed += 1;
    return loading;
  }

  /**
   * Whether a frame has something of its own on the GPU to draw tile
   * `coord` from: a coarser tile above it, or a finer one under it. What a
   * frame is moved to on while the map is being zoomed.
   */
  private standsIn(frame: ValueFrame, coord: TileCoord, minZ: number, maxZ: number): boolean {
    const resident = (tile: TileCoord) => this.residentOf(frame.job(tile.z, tile.x, tile.y)) !== undefined;
    return ancestorTile(coord, minZ, resident, ANCESTOR_REACH) !== null || childTiles(coord, maxZ, resident).length > 0;
  }

  /**
   * The piece of a frame's preview that covers `region` of tile `coord`, on
   * the GPU and pinned for this draw, uploaded now if it was not: a few
   * tens of kilobytes. Undefined where the frame has none there. With
   * `partly`, one that covers only some of the region will do.
   */
  private previewOf(
    frame: ValueFrame, coord: TileCoord, region: Extent, partly = false,
  ): { tile: GpuTile<TileTexture>; covers: Extent; z: number } | undefined {
    const piece = previews.covering(frame.key, coord.z, coord.x, coord.y, region, partly);
    if (!piece) return undefined;
    this.tiles.pin(piece.key);
    const held = this.tiles.get(piece.key);
    if (held !== undefined) return { tile: held, covers: piece.covers, z: piece.z };
    this.uploadPiece(piece);
    const tile = this.tiles.get(piece.key);
    return tile === undefined ? undefined : { tile, covers: piece.covers, z: piece.z };
  }

  /** Put a piece of a preview on the GPU, as `upload` does a tile. */
  private uploadPiece(piece: PreviewPiece): void {
    const gl = this.gl;
    const { tile, width, height } = piece;
    const bands = tile === BLANK ? 0 : tile.byteLength / (width * height);
    if (tile === BLANK || (bands !== 1 && bands !== 2)) {
      this.tiles.put(piece.key, BLANK, 0);
      return;
    }
    const texture = gl?.createTexture();
    if (!gl || !texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const [internal, format] = bands === 2 ? [gl.RG8, gl.RG] : [gl.R8, gl.RED];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.UNSIGNED_BYTE, tile);
    nearest(gl);
    this.tiles.put(piece.key, { texture, bands }, tile.byteLength);
  }

  /** A tile as it is on the GPU, pinned for this draw; undefined where it is not. */
  private residentOf(job: TileJob): GpuTile<TileTexture> | undefined {
    if (job.local) return BLANK;
    this.tiles.pin(job.key);
    return this.tiles.get(job.key);
  }

  /**
   * A tile on the GPU, uploaded now if it has been decoded, else asked for
   * where `ask`; undefined until it is there. `pending` for a frame not yet
   * switched to.
   */
  private resolve(job: TileJob, pending: boolean, ask = true): GpuTile<TileTexture> | undefined {
    const held = this.residentOf(job);
    if (held !== undefined) return held;
    const layer = this.getLayer();
    const decoded = decodedTiles.get(job.key) ?? layer.arrived.get(job.key);
    if (decoded === undefined) {
      if (ask) layer.request(job);
      return undefined;
    }
    this.upload(job, decoded);
    if (pending && decoded !== BLANK) this.pendingUploads += 1;
    return this.tiles.get(job.key);
  }

  private textureOf(tile: GpuTile<TileTexture>): WebGLTexture | null {
    return tile === BLANK ? this.blank : tile.texture;
  }

  /** A slot's palette table, built the first time it is asked for. */
  private lut(slot: RadarSlot): WebGLTexture | null {
    const gl = this.gl!;
    let texture = this.luts.get(slot.look);
    if (!texture) {
      texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tableBytes(slot.encoding, slot.palette, slot.ink));
      nearest(gl);
      this.luts.set(slot.look, texture);
    }
    return texture;
  }

  /** The context, made the first time it is needed; null while there is none to be had. */
  private context(): WebGL2RenderingContext | null {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    if (this.gl) this.lost();
    if (this.retry !== null) return null;
    const canvas = document.createElement("canvas");
    canvas.className = this.getLayer().getClassName();
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    const program = gl && link(gl);
    if (!gl || !program) {
      this.retryLater();
      return null;
    }
    // Only for the context in use: one let go on purpose says so after the next may be up.
    canvas.addEventListener("webglcontextlost", () => {
      if (canvas === this.canvas) this.lost();
    });
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const unit = gl.getAttribLocation(program, "a_unit");
    gl.enableVertexAttribArray(unit);
    gl.vertexAttribPointer(unit, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    nearest(gl);
    return gl;
  }

  /** Taken away by the browser: everything on it is gone; a new one is made shortly. */
  private lost() {
    this.forget();
    this.retryLater();
  }

  private retryLater() {
    this.retry ??= setTimeout(() => {
      this.retry = null;
      this.getLayer().changed();
    }, CONTEXT_RETRY_MS);
  }

  /** Drop every handle on the context, its textures' included, without asking it to delete them. */
  private forget() {
    this.tiles.clear(false);
    this.luts.clear();
    this.gl = null;
    this.canvas = null;
    this.program = null;
    this.quad = null;
    this.buffer = null;
    this.blank = null;
    this.items = [];
  }

  /** Let go of the context and everything on it. */
  release() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      this.tiles.clear();
      for (const texture of this.luts.values()) gl.deleteTexture(texture);
      gl.deleteTexture(this.blank);
      gl.deleteBuffer(this.buffer);
      gl.deleteVertexArray(this.quad);
      gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.forget();
  }

  override disposeInternal(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.release();
    super.disposeInternal();
  }
}

/**
 * The flat map's radar, every source a slot of it; see the module's header.
 * Made by `radarFrames`, one a map.
 */
export class RadarFrameLayer extends Layer {
  /** In the order they are drawn: by `order`, then by when they were made. */
  readonly slots: RadarSlot[] = [];

  /** In the order they were made, as OpenLayers credits layers in the order they were added. */
  private readonly made: RadarSlot[] = [];

  readonly stats: FrameStats = {
    renders: 0, slotDraws: 0, mixed: 0, switches: 0, fades: 0, previewSwitches: 0, uploads: 0, preUploads: 0, switchUploads: 0, loads: 0, failed: 0,
  };

  /** Tiles this layer loaded, until the next draw uploads them: the decoded tiles may not have kept them. */
  readonly arrived = new globalThis.Map<string, Uint8Array | typeof BLANK>();

  /** Tiles that failed to load: drawn as nothing, and not waited for, until `retryFailed`. */
  readonly failed = new Set<string>();

  /** Whether a step fades from the frame before: while playing, unless the reader turned it off. */
  fading = false;

  /** Whether a job's tile is on the GPU, for `heldOnScreen`. */
  readonly residency: TileHolder = {
    holds: (job) => this.hasRenderer() && (this.getRenderer() as FramesRenderer).holds(job.key),
  };

  private readonly loading = new globalThis.Map<string, Promise<void>>();

  private upcoming: TileJob[] = [];

  private upcomingKeys = new Set<string>();

  private retained: ReadonlySet<string> = new Set();

  private frame: number | null = null;

  private redraw: ReturnType<typeof setTimeout> | null = null;

  /** When a slot was last in view, in the map's clock. */
  private lastDrawn = 0;

  private readonly unsubscribe: Array<() => void>;

  constructor() {
    super({ zIndex: 80 });
    this.unsubscribe = [
      onFramesForgotten((now) => this.forget(now)),
      onRetry(() => this.retryFailed()),
      decodedTiles.onPut((key) => {
        if (this.upcomingKeys.has(key)) this.kick();
      }),
      // A preview of the frame a slot waits for: it can be shown now.
      previews.onPut((piece) => {
        if (this.slots.some((slot) => slot.visible && slot.frames.pending && slot.frames.wanted?.key === piece.frame)) this.changed();
      }),
    ];
  }

  override createRenderer(): LayerRenderer<RadarFrameLayer> {
    return new FramesRenderer(this);
  }

  /** A slot for `source`, drawn from now on. */
  slot(source: ValueTileSource, options: DrawingOptions): RadarSlot {
    const slot = new RadarSlot(this, source, options);
    const at = this.slots.findIndex((other) => other.order > slot.order);
    this.slots.splice(at < 0 ? this.slots.length : at, 0, slot);
    this.made.push(slot);
    this.changed();
    return slot;
  }

  /** A slot off the layer for good. */
  remove(slot: RadarSlot) {
    for (const slots of [this.slots, this.made]) {
      const at = slots.indexOf(slot);
      if (at >= 0) slots.splice(at, 1);
    }
    this.changed();
  }

  /** Fade each step from the frame before, or cut. */
  setCrossfade(on: boolean) {
    this.fading = on && CROSSFADE_MS > 0;
  }

  /**
   * The tiles of the frames coming up, nearest first: uploaded a few an
   * animation frame (`uploadsPerFrame`) as they are decoded, so that the
   * step to them uploads nothing. Replaces the last call's.
   */
  setUpcoming(jobs: readonly TileJob[]) {
    const keys = new Set<string>();
    this.upcoming = jobs.filter((job) => !job.local && !keys.has(job.key) && keys.add(job.key));
    this.upcomingKeys = keys;
    this.retainOnGpu();
    this.kick();
  }

  /** The tiles the plan of playback wants (lib/decodedTiles.ts `retain`), kept on the GPU over others. */
  retain(keys: Iterable<string>) {
    this.retained = new Set(keys);
    this.retainOnGpu();
  }

  /** What the GPU keeps over other tiles: the plan's, and the frames coming up. */
  retainedKeys(): Set<string> {
    return new Set([...this.retained, ...this.upcomingKeys]);
  }

  /** Load a tile a frame drawn needs, a few at a time, and draw again once it is in. */
  request(job: TileJob) {
    if (this.loading.has(job.key) || this.failed.has(job.key) || this.loading.size >= MAX_LOADING) return;
    const load = loadStoredTile(job)
      .then((tile) => {
        this.arrived.set(job.key, tile instanceof Uint8Array ? tile : BLANK);
        this.stats.loads += 1;
        tileArrived();
        radarTileOutcome(true);
      }, () => {
        this.failed.add(job.key);
        this.stats.failed += 1;
        radarTileOutcome(false);
      })
      .finally(() => {
        this.loading.delete(job.key);
        this.changed();
      });
    this.loading.set(job.key, load);
  }

  /** Draw again at `time`, in the map's clock: something a draw put off is due then. */
  drawAt(time: number) {
    if (this.redraw !== null) return;
    this.redraw = setTimeout(() => {
      this.redraw = null;
      this.changed();
    }, Math.max(0, time - Date.now()));
  }

  /**
   * How many of the sources drawn were, at the last draw, still on another
   * frame than the one asked for: none once the map shows the time the
   * timeline is on, sharp or not.
   */
  get behind(): number {
    return this.hasRenderer() ? (this.getRenderer() as FramesRenderer).behind : 0;
  }

  /** Bytes and tiles on the GPU now. */
  get gpu(): { bytes: number; tiles: number; capacity: number } {
    const renderer = this.hasRenderer() ? this.getRenderer() as FramesRenderer : null;
    return { bytes: renderer?.tiles.bytes ?? 0, tiles: renderer?.tiles.size ?? 0, capacity: frameTextureBytes() };
  }

  /** The credits of the slots drawn where the view is, as an OpenLayers layer gives its source's. */
  override getAttributions(view?: View | ViewStateLayerStateExtent): string[] {
    if (!this.isVisible(view)) return [];
    const map = this.getMapInternal();
    const frameState = view instanceof View ? view.getViewStateAndExtent() : view ?? map?.getView().getViewStateAndExtent();
    if (!frameState) return [];
    const credits: string[] = [];
    for (const slot of this.made) {
      if (!slot.visible || !slot.frames.wanted || (slot.extent && !intersects(slot.extent, frameState.extent))) continue;
      const attributions = slot.source.getAttributions()?.(frameState);
      if (attributions) credits.push(...(Array.isArray(attributions) ? attributions : [attributions]));
    }
    return credits;
  }

  /** Drawn; or, with no slot in view for `IDLE_AFTER_MS` while the map draws, its context let go. */
  override render(frameState: FrameState | null, target: HTMLElement): HTMLElement | null {
    const element = super.render(frameState, target);
    if (!frameState) return element;
    if (element || !this.lastDrawn) this.lastDrawn = frameState.time;
    else if (frameState.time - this.lastDrawn > IDLE_AFTER_MS && (this.getRenderer() as FramesRenderer).live) this.clearRenderer();
    // A context made by this draw has the frames coming up still to take.
    this.kick();
    return element;
  }

  override disposeInternal(): void {
    for (const stop of this.unsubscribe) stop();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.redraw !== null) clearTimeout(this.redraw);
    super.disposeInternal();
  }

  private retainOnGpu() {
    if (this.hasRenderer()) (this.getRenderer() as FramesRenderer).tiles.retain(this.retainedKeys());
  }

  /** Upload the next few tiles coming up, an animation frame from now. */
  private kick() {
    if (this.frame !== null || !this.upcoming.length || typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.preUpload();
    });
  }

  private preUpload() {
    const renderer = this.hasRenderer() ? this.getRenderer() as FramesRenderer : null;
    if (!renderer?.live) return;
    let budget = uploadsPerFrame();
    for (const job of this.upcoming) {
      if (renderer.holds(job.key)) continue;
      const tile = decodedTiles.peek(job.key);
      if (tile === undefined) continue;
      if (tile !== BLANK && budget === 0) {
        this.kick();
        return;
      }
      renderer.upload(job, tile);
      if (tile !== BLANK) {
        budget -= 1;
        this.stats.preUploads += 1;
      }
    }
  }

  /**
   * The earlier frames let go (layers/valueTiles.ts): with the map out of
   * sight, everything, the context too; else every texture but those on
   * screen, which stay until the frame after them is up.
   */
  private forget(now: boolean) {
    this.setUpcoming([]);
    this.arrived.clear();
    if (now) this.clearRenderer();
    else if (this.hasRenderer()) (this.getRenderer() as FramesRenderer).tiles.dropUnpinned();
  }

  /** Ask again for the tiles that failed; true when there was one. */
  private retryFailed(): boolean {
    if (!this.failed.size) return false;
    this.failed.clear();
    this.changed();
    return true;
  }
}

/** The frame layer of each map that has one. */
const frameLayers = new WeakMap<Map, RadarFrameLayer>();

/**
 * The map's frame layer, put on it the first time it is asked for; null
 * where the radar is drawn by tile layers instead: a browser without WebGL2,
 * or the `radarRenderer` setting at "tiles".
 */
export function radarFrames(map: Map): RadarFrameLayer | null {
  if (window.settings?.getString<string>("radarRenderer", "frames") === "tiles" || !webgl2Supported()) return null;
  let layer = frameLayers.get(map);
  if (!layer) {
    layer = new RadarFrameLayer();
    map.addLayer(layer);
    frameLayers.set(map, layer);
  }
  return layer;
}
