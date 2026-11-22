/**
 * Lakes and rivers under a flight that read as water: the sky in them where
 * they are seen at a slant, the sun's glitter on them towards the sun, and
 * a ripple that moves. On the imagery a lake is a dark shape and on the
 * drawn map a flat one, and from a cockpit neither looks like water.
 *
 * The water's shapes are the basemap's own (`BASEMAP_SOURCE`, its `water`
 * layer): the tiles the map has loaded to draw the ground with, flight or
 * not, so nothing is fetched for it and no one new is credited. Over the
 * satellite imagery as well, where the basemap draws no water of its own
 * but its tiles still carry it.
 *
 * A layer of its own GL (MapLibre's custom layer), not a fill: a fill is
 * draped over the terrain, one colour however the camera looks at it, and
 * water is all about how it is looked at. A custom layer is not draped, so
 * each surface is put at its height itself (waterMesh.ts says how high), a
 * little over the ground so the ground does not show through it.
 *
 * ## How it looks
 *
 * Seen from straight above, water reflects little and the lake bed's own
 * colour, which is what the imagery shows, comes through; at a slant it
 * reflects more and more, until near the horizon it is a mirror of the sky
 * (Fresnel). The sky it reflects is the flight's (`FLIGHT_SKY` in the 3D
 * map), deep blue overhead and pale at the horizon, read off the map.
 *
 * Its surface is a handful of waves summed, from a few metres to fifty
 * long, each running at the speed of real water's waves of its length,
 * worked out per pixel: nothing is downloaded and nothing held on the GPU
 * but the shapes. A wave too fine for the pixels to show is not drawn, or
 * it would flicker as noise; it roughens the surface instead, which spreads
 * the sun's glitter wider and dimmer, the way a far lake's is. Patches of a
 * few hundred metres are rougher than others, as a gust leaves them.
 *
 * The sun is the one the flight's clouds are lit by (`SUN_DIRECTION`), and
 * its glitter on the water follows it and the camera, as glitter does. The
 * far water fades into the haze as the ground does, by the map's own rule
 * for its fog, or a lake on the horizon would stand out bright against it.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GlMap, OverscaledTileID } from "maplibre-gl";
import { invert, multiply } from "../../../layers/cellVolumeLayer";
import { BASEMAP_SOURCE } from "../../../layers/maplibreStyle";
import { SUN_DIRECTION } from "../../../layers/scenicPass";
import { VERTICAL_SCALE } from "../../../layers/terrain";
import { cameraOf } from "../../drawOrder";
import { drapeAnchor, isHandheld } from "../../gpuBudget";
import { heightsOf, piecesOf, type Piece, type WaterFeature } from "./waterMesh";

export const FLIGHT_WATER = "flight-water";

/** The basemap's layer of water, in each of its tiles. */
const SOURCE_LAYER = "water";

/**
 * The sea as well as the lakes. It is the most water there is under a
 * flight, and its glitter and its sky are as much of what a coast looks like
 * from the air as a lake's; at a steep angle it lets the sea's depths
 * (seabed.ts) show through, which is how water shows what is under it.
 */
const WITH_SEA = true;

/**
 * How far over the ground a surface is drawn, metres as drawn. The ground is
 * a mesh between the points its heights are known at, and near a shore that
 * mesh can lie a metre or two over the water's own height: with nothing
 * between them, the land would show through the water in specks there.
 */
const LIFT_M = 2 * VERTICAL_SCALE;

/**
 * How far each tile's water reaches into its neighbours', in a tile's units
 * (4096 across). Cut exactly at the tile's edge, two tiles' water meets on
 * one line, but each tile is put on screen through numbers of its own,
 * rounded differently: a pixel here and there along the seam fell between
 * the two and was not drawn, and another was drawn by both, a dotted line of
 * dark and bright specks across a lake. Overlapping, none falls between, and
 * the stencil keeps any from being drawn twice.
 */
const SEAM = 0.5;

/** The Earth round the equator, metres: what one of Mercator's units is there. */
const EARTH_M = 40075016.686;

/** How often the tiles the map draws are looked through for new ones, ms. */
const SCAN_MS = 250;

/** How long a frame may spend cutting new tiles' water into triangles, ms: a tile that does not fit waits for the next. */
const BUILD_MS = 4;

/** How long a tile's water is kept once the map stops drawing it, in case it comes back, ms. */
const KEEP_MS = 8000;

/** How often the surfaces are measured again for terrain loaded since, at most, ms. */
const MEASURE_MS = 1000;

/**
 * The pattern the ripples and gusts repeat in, metres. Tiles are drawn each
 * from its own corner, in single precision, and each is told where its corner
 * lies in the pattern, modulo this: the pattern then runs on across the
 * seams. Every wave fits it a whole number of times, and so do the gusts'
 * cells (`GUST_CELLS`), so the modulo is not seen either.
 */
const PATTERN_M = 24576;
const GUST_CELLS = 64;

/**
 * The waves, each as how many of it fit across the pattern east and north
 * (the way it runs and its length: 48 m down to 2.3 m) and its steepness.
 * Mostly one way, as the wind sends them, spread forty degrees or so either
 * side. The short ones are the steep ones, as on real water; long ones as
 * steep, seen from a few thousand feet, drew a lattice across the glitter.
 */
const WAVES: ReadonlyArray<readonly [number, number, number]> = [
  [504, 90, 0.012], [648, -453, 0.016], [990, 831, 0.022], [1899, -510, 0.028],
  [1350, 2892, 0.034], [2763, -3948, 0.04], [6549, 3054, 0.042], [10644, -930, 0.04],
];

/** How rough the water is beside its waves, as a mean square slope: a light breeze's (Cox and Munk). */
const ROUGH = 0.006;

const VERTEX = `#version 300 es
uniform mat4 uMatrix;
uniform float uUnit;
uniform vec2 uPhase;
uniform vec3 uEye;
// A corner of the water: east and south of its tile's corner in the tile's units, and how high, metres as drawn.
in vec3 aPosition;
// Where it is in the ripples' pattern, metres east and north.
out vec2 vAt;
out vec3 vToEye;
// How far it is from the eye along the view, in the map's units, for the haze.
out float vDistance;
void main() {
  vec3 here = vec3(aPosition.x * uUnit, -aPosition.y * uUnit, aPosition.z);
  vAt = here.xy + uPhase;
  vToEye = uEye - here;
  gl_Position = uMatrix * vec4(aPosition, 1.0);
  vDistance = gl_Position.w;
}`;

/** The water's look, with `waves` of `WAVES` drawn and the rest left to its roughness. */
function fragment(waves: number): string {
  const list = WAVES.map(([east, north, steep]) => `vec3(${east.toFixed(1)}, ${north.toFixed(1)}, ${steep})`).join(", ");
  return `#version 300 es
precision highp float;
in vec2 vAt;
in vec3 vToEye;
in float vDistance;
uniform vec3 uSun;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColour;
uniform vec3 uFogHorizon;
// The haze: from how near and to how far, where on the ground it begins and where it turns the horizon's colour, how much of it.
uniform vec4 uFog;
uniform float uFogShare;
uniform vec4 uBody;
uniform float uTime;
out vec4 colour;

const float TAU = 6.2831853;
const float PATTERN = ${PATTERN_M.toFixed(1)};
const vec3 WAVES[${WAVES.length}] = vec3[${WAVES.length}](${list});
const vec3 SUNLIGHT = vec3(1.0, 0.96, 0.88);

// A cell's own value, 0 to 1. In whole numbers: a float's remainder can come out a hair under 0, and a cell's value wildly wrong, in a speck.
float cell(ivec2 at, int cells) {
  uvec2 q = uvec2(at & (cells - 1)) * uvec2(1597334673u, 3812015801u);
  return float((q.x ^ q.y) * 1597334673u) * (1.0 / 4294967295.0);
}

/** Smooth noise, 0 to 1, over cells a unit across that repeat every \`cells\` (a power of two). */
float noise(vec2 at, int cells) {
  ivec2 i = ivec2(floor(at));
  vec2 f = fract(at);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cell(i, cells), cell(i + ivec2(1, 0), cells), u.x),
    mix(cell(i + ivec2(0, 1), cells), cell(i + 1, cells), u.x), u.y);
}

vec3 sky(vec3 ray) {
  return mix(uHorizon, uZenith, smoothstep(0.0, 1.0, pow(clamp(ray.z, 0.0, 1.0), 0.5)));
}

float fresnel(float facing) {
  return 0.02 + 0.98 * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}

void main() {
  vec3 toEye = normalize(vToEye);
  // How many metres of water one pixel covers: finer waves than a few pixels are roughness, not waves.
  float footprint = max(length(dFdx(vAt)), length(dFdy(vAt)));
  // Gusts: patches a few hundred metres across, rougher or calmer, drifting
  // downwind. Each wave is stronger in some patches than others, one half of
  // them by the broad patches and the other by the fine: drawn as evenly as
  // each other, a few waves crossing drew a lattice.
  vec2 drift = vec2(4.0, 1.0) * uTime;
  float broad = noise((vAt - drift) / ${(PATTERN_M / GUST_CELLS).toFixed(1)}, ${GUST_CELLS});
  float fine = noise((vAt - drift * 0.7) / ${(PATTERN_M / GUST_CELLS / 2).toFixed(1)}, ${GUST_CELLS * 2});
  float gust = 0.35 + 1.15 * (0.65 * broad + 0.35 * fine);
  vec2 slope = vec2(0.0);
  float rough = ${ROUGH};
  for (int i = 0; i < ${WAVES.length}; i += 1) {
    vec2 k = WAVES[i].xy * (TAU / PATTERN);
    float wavenumber = length(k);
    float steep = WAVES[i].z;
    float seen = ${waves} > i ? smoothstep(2.5, 7.0, TAU / wavenumber / footprint) : 0.0;
    // Deep water's waves: the longer, the faster.
    float phase = dot(k, vAt) - sqrt(9.81 * wavenumber) * uTime;
    float here = 0.2 + 1.6 * ((i & 1) == 0 ? broad : fine);
    slope += steep * seen * here * cos(phase) * k / wavenumber;
    rough += 0.5 * steep * steep * (1.0 - seen * seen);
  }
  rough *= gust;
  vec3 normal = normalize(vec3(-slope, 1.0));
  float facing = max(dot(normal, toEye), 0.0);
  float reflected = fresnel(facing);
  vec3 ray = reflect(-toEye, normal);

  // The sun's glitter: the share of the surface's facets that tilt to send it to the eye (Beckmann's).
  vec3 halfway = normalize(toEye + uSun);
  float c = max(dot(halfway, normal), 1e-3);
  float c2 = c * c;
  float facets = exp((c2 - 1.0) / (c2 * rough)) / (3.14159 * rough * c2 * c2);
  float glitter = 1.6 * facets * fresnel(dot(halfway, toEye)) / (4.0 * max(facing, 0.05)) * step(0.0, uSun.z);

  vec3 lit = uBody.rgb * uBody.a * (1.0 - reflected) + sky(ray) * reflected + SUNLIGHT * glitter;
  float alpha = uBody.a * (1.0 - reflected) + reflected;

  // The haze, as the map lays it on the ground under: the ground there is in it already, so this is too.
  float depth = uFog.y / (uFog.y - uFog.x) * (1.0 - uFog.x / max(vDistance, 1e-3));
  float haze = 0.0;
  if (depth > uFog.z) {
    haze = pow((depth - uFog.z) / (1.0 - uFog.z), 2.0) * uFogShare;
  }
  vec3 hazeColour = mix(uFogColour, uFogHorizon, smoothstep(0.0, 1.0, max((depth - uFog.w) / (1.0 - uFog.w), 0.0)));
  colour = vec4(lit * (1.0 - haze) + hazeColour * alpha * haze, alpha);
}`;
}

/** The colours of the flight's sky and haze, as the map has them, or as the flight sets them. */
interface Sky {
  zenith: [number, number, number];
  horizon: [number, number, number];
  fog: [number, number, number];
  groundBlend: number;
  horizonBlend: number;
}

/** "#rrggbb" to 0–1 channels; `otherwise` for anything else. */
function rgb(value: unknown, otherwise: [number, number, number]): [number, number, number] {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return otherwise;
  const packed = parseInt(value.slice(1), 16);
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255];
}

function skyOf(gl: GlMap): Sky {
  const sky = gl.getSky() ?? {};
  const number = (value: unknown, otherwise: number) => (typeof value === "number" ? value : otherwise);
  return {
    zenith: rgb(sky["sky-color"], [0.12, 0.37, 0.72]),
    horizon: rgb(sky["horizon-color"], [0.84, 0.9, 0.96]),
    fog: rgb(sky["fog-color"], [0.8, 0.86, 0.92]),
    groundBlend: number(sky["fog-ground-blend"], 0.35),
    horizonBlend: number(sky["horizon-fog-blend"], 0.75),
  };
}

/**
 * The water's own colour, and how much of what is under it it hides seen
 * from straight above. Over the imagery a lake's bed is in the picture
 * already, and the water darkens it a little; over the drawn map's flat
 * water a little more, which is the depth the drawing does not have; over
 * the dark map its water is nearly black, and is left as it is.
 */
export interface WaterLook {
  satellite: boolean;
  dark: boolean;
}

function bodyOf(look: WaterLook): [number, number, number, number] {
  if (look.satellite) return [0.03, 0.075, 0.09, 0.3];
  return look.dark ? [0.02, 0.04, 0.06, 0.1] : [0.1, 0.17, 0.22, 0.14];
}

/** One tile's water, on the GPU and as it was cut up. */
interface TileWater {
  id: OverscaledTileID;
  extent: number;
  pieces: Piece[];
  /** Each piece's heights as last measured, and its own one height where it is level. */
  measured: Array<{ heights: Float32Array; level: number | null }> | null;
  /** The zoom of the terrain it was measured on: the finer, the truer. */
  terrainZoom: number;
  /** The corners as uploaded: x, y, height. */
  corners: Float32Array;
  buffer: WebGLBuffer;
  indices: WebGLBuffer;
  vertexArray: WebGLVertexArrayObject;
  count: number;
  seen: number;
}

/** What a vector tile's feature index offers the water. */
interface FeatureSource {
  loadVTLayers(): Record<string, { length: number; extent: number; feature(index: number): WaterFeature } | undefined>;
}

/**
 * How much of the water's look a flight's sharpness (`setFlightQuality`)
 * leaves: how many of its waves are worked out, or none of it drawn at all.
 * A phone works out half of them from the start: the fine ones it drops are
 * mostly too fine for its pixels below a few hundred feet anyway.
 */
export function wavesFor(quality: number, handheld: boolean): number | null {
  if (quality < 0.2) return null;
  if (quality < 0.4) return 0;
  return handheld || quality < 0.7 ? 4 : WAVES.length;
}

export interface WaterLayer extends CustomLayerInterface {
  setQuality(share: number): void;
}

function makeWaterLayer(look: WaterLook, quality: number): WaterLayer {
  let map: GlMap | null = null;
  let context: WebGL2RenderingContext | null = null;
  const programs = new Map<number, { program: WebGLProgram; at: Map<string, WebGLUniformLocation | null> }>();
  const tiles = new Map<string, TileWater>();
  let drawn: TileWater[] = [];
  let queue: Array<{ key: string; id: OverscaledTileID; source: FeatureSource }> = [];
  let scannedAt = -Infinity;
  let measuredAt = -Infinity;
  let terrainChanged = true;
  let waves = wavesFor(quality, isHandheld());
  const body = bodyOf(look);
  const started = performance.now();

  /** New terrain is new ground to measure the water against. */
  const onData = (event: { sourceId?: string; tile?: unknown; source?: { type?: string } }) => {
    if (event.tile && event.source?.type === "raster-dem") terrainChanged = true;
  };

  function programFor(count: number) {
    const gl = context!;
    let found = programs.get(count);
    if (found) return found;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "water shader would not compile");
      return shader;
    };
    const program = gl.createProgram()!;
    const shaders = [compile(gl.VERTEX_SHADER, VERTEX), compile(gl.FRAGMENT_SHADER, fragment(count))];
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "water shader would not link");
    found = { program, at: new Map() };
    programs.set(count, found);
    return found;
  }

  function drop(tile: TileWater) {
    const gl = context;
    if (!gl) return;
    gl.deleteBuffer(tile.buffer);
    gl.deleteBuffer(tile.indices);
    gl.deleteVertexArray(tile.vertexArray);
  }

  /**
   * Which of the tiles the map draws the water is drawn from: those of the
   * basemap with data, and of a tile and its own finer ones (the map keeps a
   * coarser tile while the finer ones load) only the coarser. Drawn both, the
   * water there would be drawn twice over.
   */
  function scan(gl: GlMap, now: number) {
    const manager = gl.style?.tileManagers?.[BASEMAP_SOURCE];
    if (!manager) return;
    const found = new Map<string, { id: OverscaledTileID; source: FeatureSource }>();
    for (const key of manager.getRenderableIds()) {
      const tile = manager.getTileByID(key);
      const source = tile?.latestFeatureIndex as unknown as FeatureSource | null | undefined;
      if (!tile || !source) continue;
      const { z, x, y } = tile.tileID.canonical;
      const name = `${tile.tileID.wrap}/${z}/${x}/${y}`;
      if (!found.has(name)) found.set(name, { id: tile.tileID, source });
    }
    const covered = (id: OverscaledTileID) => {
      const { z, x, y } = id.canonical;
      for (let up = 1; up <= z; up += 1) {
        if (found.has(`${id.wrap}/${z - up}/${x >> up}/${y >> up}`)) return true;
      }
      return false;
    };
    const wanted = [...found].filter(([, { id }]) => !covered(id));
    queue = wanted.filter(([key]) => !tiles.has(key)).map(([key, { id, source }]) => ({ key, id, source }));
    drawn = [];
    for (const [key] of wanted) {
      const tile = tiles.get(key);
      if (!tile) continue;
      tile.seen = now;
      drawn.push(tile);
    }
    for (const [key, tile] of tiles) {
      if (now - tile.seen > KEEP_MS) {
        drop(tile);
        tiles.delete(key);
      }
    }
  }

  /** Cut queued tiles' water into triangles, as long as the frame can spare. */
  function build(now: number): TileWater[] {
    const gl = context!;
    const until = performance.now() + BUILD_MS;
    const built: TileWater[] = [];
    while (queue.length && performance.now() < until) {
      const { key, id, source } = queue.shift()!;
      const layer = source.loadVTLayers()[SOURCE_LAYER];
      const features: WaterFeature[] = [];
      for (let index = 0; layer && index < layer.length; index += 1) features.push(layer.feature(index));
      const extent = layer?.extent ?? 4096;
      const pieces = layer ? piecesOf(features, extent, WITH_SEA, SEAM) : [];
      const cornerCount = pieces.reduce((sum, piece) => sum + piece.points.length / 2, 0);
      const corners = new Float32Array(cornerCount * 3);
      const indices = new Uint32Array(pieces.reduce((sum, piece) => sum + piece.triangles.length, 0));
      let corner = 0;
      let index = 0;
      for (const piece of pieces) {
        for (const triangle of piece.triangles) indices[index++] = corner + triangle;
        for (let point = 0; point < piece.points.length; point += 2) {
          corners[corner * 3] = piece.points[point];
          corners[corner * 3 + 1] = piece.points[point + 1];
          corner += 1;
        }
      }
      const buffer = gl.createBuffer()!;
      const indexBuffer = gl.createBuffer()!;
      const vertexArray = gl.createVertexArray()!;
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const tile: TileWater = {
        id, extent, pieces, measured: null, terrainZoom: 0, corners, buffer, indices: indexBuffer, vertexArray, count: indices.length, seen: now,
      };
      tiles.set(key, tile);
      if (pieces.length) {
        drawn.push(tile);
        built.push(tile);
      }
    }
    return built;
  }

  /**
   * Measure the ground under each tile's water and put its surfaces at their
   * heights (waterMesh.ts), the pieces of one lake at the lowest any of them
   * found. A tile whose ground has no terrain loaded under it yet is left
   * unmeasured, and undrawn: drawn at sea level it would be under the ground.
   * Only `fresh` tiles are measured; every tile is put at the heights found.
   */
  function measure(gl: GlMap, fresh: TileWater[]) {
    const terrain = gl.terrain;
    for (const tile of fresh) {
      if (!tile.pieces.length) continue;
      const under = terrain?.tileManager.getSourceTile(tile.id, true);
      if (terrain && !under?.dem) {
        tile.measured = null;
        continue;
      }
      tile.terrainZoom = under?.tileID.overscaledZ ?? 0;
      const top = tile.extent - 1;
      const ground = (x: number, y: number) => (
        terrain ? terrain.getElevation(tile.id, Math.min(Math.max(x, 0), top), Math.min(Math.max(y, 0), top), tile.extent) : 0
      );
      tile.measured = tile.pieces.map((piece) => heightsOf(piece, ground));
    }
    // A lake's height from its pieces measured on the finest terrain, and of
    // those the lowest. Coarse terrain is the fine one averaged, and where
    // it has the lake's bed in it, a lake measured on it came out tens of
    // metres under its own surface, and under the ground where that is drawn
    // from finer tiles: Lake Geneva was not to be seen.
    const lakes = new Map<string, { zoom: number; level: number }>();
    for (const tile of tiles.values()) {
      tile.pieces.forEach((piece, index) => {
        const level = tile.measured?.[index].level;
        if (piece.lake === null || level === null || level === undefined) return;
        const known = lakes.get(piece.lake);
        if (!known || tile.terrainZoom > known.zoom) lakes.set(piece.lake, { zoom: tile.terrainZoom, level });
        else if (tile.terrainZoom === known.zoom) known.level = Math.min(known.level, level);
      });
    }
    const webgl = context!;
    for (const tile of tiles.values()) {
      if (!tile.measured) continue;
      let corner = 0;
      let changed = false;
      tile.pieces.forEach((piece, index) => {
        const { heights, level } = tile.measured![index];
        const lake = piece.lake !== null && level !== null ? lakes.get(piece.lake)?.level : undefined;
        for (let point = 0; point < heights.length; point += 1) {
          const height = (lake ?? heights[point]) + LIFT_M;
          if (Math.abs(tile.corners[corner * 3 + 2] - height) > 0.25) changed = true;
          tile.corners[corner * 3 + 2] = height;
          corner += 1;
        }
      });
      if (!changed) continue;
      webgl.bindBuffer(webgl.ARRAY_BUFFER, tile.buffer);
      webgl.bufferSubData(webgl.ARRAY_BUFFER, 0, tile.corners);
    }
  }

  return {
    id: FLIGHT_WATER,
    type: "custom",
    renderingMode: "3d",

    setQuality(share) {
      waves = wavesFor(share, isHandheld());
    },

    onAdd(added: GlMap, gl: WebGL2RenderingContext) {
      map = added;
      context = gl;
      added.on("sourcedata", onData);
    },

    onRemove(removed: GlMap, gl: WebGL2RenderingContext) {
      removed.off("sourcedata", onData);
      for (const tile of tiles.values()) drop(tile);
      tiles.clear();
      drawn = [];
      queue = [];
      for (const { program } of programs.values()) gl.deleteProgram(program);
      programs.clear();
      map = null;
      context = null;
    },

    render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!map || waves === null) return;
      const now = performance.now();
      if (now - scannedAt > SCAN_MS) {
        scannedAt = now;
        scan(map, now);
      }
      const built = build(now);
      if (terrainChanged && now - measuredAt > MEASURE_MS) {
        terrainChanged = false;
        measuredAt = now;
        measure(map, [...tiles.values()]);
      } else if (built.length) {
        measure(map, built);
      }
      if (!drawn.length) return;

      const main = options.defaultProjectionData.mainMatrix;
      const back = invert(main);
      if (!back) return;
      // The eye, in Mercator's units: east, south and up.
      const [eyeX, eyeY, eyeZ] = cameraOf(back);
      // The ripples are laid out in metres at a latitude near the eye's, the
      // same for every tile, so that they meet at the seams. To the nearest
      // five degrees: the pattern jumps when that changes, once in a long
      // flight north or south, where with the eye's own it would crawl.
      const eyeLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * eyeY))) * 180 / Math.PI;
      const metre = 1 / (EARTH_M * Math.cos((Math.round(eyeLat / 5) * 5 * Math.PI) / 180));
      const sky = skyOf(map);
      // The haze's near end as the map works it out for its ground (MapLibre's fog matrix), and its far one.
      const transform = map._camera.transform;
      const pitch = (Math.min(transform.pitch, 89.25) * Math.PI) / 180;
      const near = Math.max(
        transform.cameraToCenterDistance / 2,
        transform.cameraToCenterDistance + (transform.elevation * transform.pixelsPerMeter) / Math.cos(pitch),
      );
      const fogShare = transform.pitch < 60 ? 0 : transform.pitch < 70 ? (transform.pitch - 60) / 10 : 1;
      const [east, north, up] = SUN_DIRECTION;
      const sunLength = Math.hypot(east, north, up);

      const { program, at } = programFor(waves);
      const uniform = (name: string) => {
        if (!at.has(name)) at.set(name, gl.getUniformLocation(program, name));
        return at.get(name) ?? null;
      };
      gl.useProgram(program);
      gl.uniform3f(uniform("uSun"), east / sunLength, north / sunLength, up / sunLength);
      gl.uniform3f(uniform("uZenith"), ...sky.zenith);
      gl.uniform3f(uniform("uHorizon"), ...sky.horizon);
      gl.uniform3f(uniform("uFogColour"), ...sky.fog);
      gl.uniform3f(uniform("uFogHorizon"), ...sky.horizon);
      gl.uniform4f(uniform("uFog"), near, options.farZ, sky.groundBlend, sky.horizonBlend);
      gl.uniform1f(uniform("uFogShare"), fogShare);
      gl.uniform4f(uniform("uBody"), ...body);
      gl.uniform1f(uniform("uTime"), ((now - started) / 1000) % 3600);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // Tested, not written: what is drawn after it over the ground (the storms' rain) meets the ground's depth there, which is the water's.
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      // Each pixel drawn once, however many tiles or shapes cover it: where
      // two tiles reach into each other at a seam (`SEAM`), or two of the
      // tiles' shapes lie over each other, the water would otherwise be drawn
      // twice there, twice as bright. On a stencil of its own, cleared before
      // and after, and the map told so, which keeps its own in the stencil
      // between layers.
      gl.disable(gl.SCISSOR_TEST);
      gl.stencilMask(0xff);
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);

      const wrapped = (value: number) => ((value % PATTERN_M) + PATTERN_M) % PATTERN_M;
      for (const tile of drawn) {
        if (!tile.measured || !tile.count) continue;
        const { z, x, y } = tile.id.canonical;
        const span = 1 / 2 ** z;
        const originX = tile.id.wrap + x * span;
        const originY = y * span;
        const unit = span / tile.extent;
        // Its own metres up, at its own latitude.
        const tileLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (originY + span / 2)))) * 180 / Math.PI;
        const upward = 1 / (EARTH_M * Math.cos((tileLat * Math.PI) / 180));
        const matrix = multiply(main, [unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, upward, 0, originX, originY, 0, 1]);
        gl.uniformMatrix4fv(uniform("uMatrix"), false, new Float32Array(matrix));
        gl.uniform1f(uniform("uUnit"), unit / metre);
        gl.uniform2f(uniform("uPhase"), wrapped(originX / metre), wrapped(-originY / metre));
        gl.uniform3f(uniform("uEye"), (eyeX - originX) / metre, -(eyeY - originY) / metre, eyeZ / upward);
        gl.bindVertexArray(tile.vertexArray);
        gl.drawElements(gl.TRIANGLES, tile.count, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
      map.painter.currentStencilSource = undefined as unknown as string;
      map.painter.nextStencilID = 1;
      // Tiles still to cut: another frame for them, whether or not the camera moves.
      if (queue.length) map.triggerRepaint();
    },
  };
}

/**
 * Lay the water on, or take it off. Called again after every new style:
 * a custom layer survives a style the map could diff against the old one,
 * and adding it a second time would fail, so what is there goes first.
 *
 * Over the ground and everything draped on it, the imagery and the sea's
 * depths among them; under the buildings, the storms and the names (see
 * `drapeAnchor`: added after the buildings, it goes in just under them).
 */
function add(gl: GlMap, look: WaterLook, quality: number): void {
  remove(gl);
  if (!gl.getSource(BASEMAP_SOURCE)) return;
  gl.addLayer(makeWaterLayer(look, quality), drapeAnchor(gl.getStyle().layers));
}

function remove(gl: GlMap): void {
  if (gl.getLayer(FLIGHT_WATER)) gl.removeLayer(FLIGHT_WATER);
}

/** The flight's sharpness changed (`setFlightQuality`): as many waves as it leaves room for. */
function quality(gl: GlMap, share: number): void {
  const layer = gl.getLayer(FLIGHT_WATER) as unknown as { implementation?: WaterLayer } | undefined;
  layer?.implementation?.setQuality(share);
}

/** Handed to the 3D map with the rest of the flight's code (support.ts). */
export const water = { add, remove, quality };
