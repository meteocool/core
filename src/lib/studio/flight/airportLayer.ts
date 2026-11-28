/**
 * The airports under a flight, drawn: every runway's lights, on the drawn
 * map its runways and taxiways too, and the larger airports' names.
 *
 * The lights are what an airport is from the air, in a storm's gloom most
 * of all: white along the edges, green across the start and red across the
 * end, a line leading up to a long runway with its flashes running in
 * towards it, and beside each start the four lights of the slope
 * indicator, which turn from red to white one by one the higher the eye is
 * over the three degrees down to the runway. All of them are points, one
 * draw an airport, each given its colour and its size by where the eye is.
 *
 * Over the satellite imagery the runways are in the picture already, and
 * only the lights are added. The drawn map has none, so there each runway
 * is laid on the ground with its markings, and the taxiways beside it.
 *
 * A layer of its own GL, not draped: a draped line is as many pixels wide
 * whatever it is on, and a runway is so many metres. So each light and each
 * corner of a runway is put at the ground's height itself, as the map draws
 * it (water.ts's `drawnGround`), and drawn a little nearer the eye than it
 * is, which keeps the ground it lies on from showing through it.
 *
 * Which airports there are is airportWorld.ts's; this draws whatever it
 * holds, and builds it anew when that changes.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, ExpressionSpecification, FilterSpecification, Map as GlMap } from "maplibre-gl";
import { invert, multiply } from "../../../layers/cellVolumeLayer";
import { LABEL_FAMILY } from "../../../layers/labels";
import { BASEMAP_SOURCE } from "../../../layers/maplibreStyle";
import { VERTICAL_SCALE } from "../../../layers/terrain";
import { FEET } from "../../../components/studio/flight/instruments";
import { cameraOf } from "../../drawOrder";
import { drapeAnchor } from "../../gpuBudget";
import { LIGHT_FLOATS, runwayLights } from "./airports";
import type { Airport, LonLat } from "./airports";
import { airportWorld } from "./airportWorld";
import { offsetM } from "./geo";
import { chartPalette } from "./peaks";
import type { ChartLook } from "./peaks";
import { drawnGround } from "./water";
import type { CoverageIndex } from "./water";

export const FLIGHT_AIRPORTS = "flight-airports";
const AIRPORT_NAMES = "flight-airport-names";

/** The Earth round the equator, metres: what one of Mercator's units is there. */
const EARTH_M = 40075016.686;

/** How far over the ground the lights and the runways are drawn, metres as drawn. */
const LIGHT_LIFT_M = 1.5 * VERTICAL_SCALE;
const SURFACE_LIFT_M = 1 * VERTICAL_SCALE;
/** How much nearer the eye than they are, as a share of the way to it: the lights, which may shine over a rise, and the runways. */
const LIGHT_NEARER = 0.02;
const SURFACE_NEARER = 0.012;

/** How far off an airport's lights are seen, and its runways, metres: fading out over the further half. */
const LIGHTS_SEEN_M = 36_000;
const SURFACE_SEEN_M = 45_000;

/** How often the ground under the airports is measured again for terrain loaded since, at most, ms. */
const MEASURE_MS = 1000;

/** Floats a corner of a runway or taxiway takes: where (3), how far across and along it, how long it is (less than 0 for a taxiway), half its width. */
const SURFACE_FLOATS = 7;
/** Between two cross-sections of a runway, and of a taxiway, metres: what lets them follow the ground. */
const RUNWAY_STEP_M = 60;
const TAXIWAY_STEP_M = 100;
/** Half a taxiway's width, metres. */
const TAXIWAY_HALF_M = 9;

const LIGHT_VERTEX = `#version 300 es
uniform mat4 uMatrix;
// The eye, metres east, north and up (as drawn) of the airport's middle.
uniform vec3 uEye;
uniform float uTime;
// How many pixels a metre is, a metre from the eye.
uniform float uFocal;
uniform float uStretch;
uniform float uSeen;
in vec3 aPlace;
in vec3 aColour;
// Which way it shines (east, north; nothing for all round), and what else it does.
in vec3 aAim;
out vec4 vColour;
void main() {
  vec3 toEye = uEye - aPlace;
  float away = max(length(toEye), 1.0);
  float shine = 1.0;
  if (dot(aAim.xy, aAim.xy) > 0.5) shine = smoothstep(-0.05, 0.3, dot(normalize(toEye.xy), aAim.xy));
  vec3 colour = aColour;
  float large = 1.0;
  if (aAim.z > 0.0) {
    // The slope indicator: white from above its angle, red from below. The angle is the true one, heights being drawn taller.
    float angle = degrees(atan(toEye.z / uStretch, length(toEye.xy)));
    colour = mix(vec3(1.0, 0.1, 0.06), vec3(1.0, 0.97, 0.9), smoothstep(aAim.z - 0.06, aAim.z + 0.06, angle));
    large = 1.5;
  } else if (aAim.z < 0.0) {
    // A flash, twice a second, each in its turn.
    shine *= step(fract(uTime * 2.0 + aAim.z), 0.08);
    large = 1.8;
  }
  // A light a few metres across with its glow; never under two pixels, and fainter for it from far off.
  float size = 5.0 * large * uFocal / away;
  float least = 2.2 * large * max(uFocal / 1300.0, 1.0);
  shine *= clamp(size / least, 0.1, 1.0) * mix(1.0, 0.5, smoothstep(4000.0, 15000.0, away)) * (1.0 - smoothstep(uSeen * 0.5, uSeen, away));
  vColour = vec4(colour, shine);
  gl_PointSize = clamp(size, least, 22.0 * max(uFocal / 1300.0, 1.0));
  gl_Position = uMatrix * vec4(mix(aPlace, uEye, ${LIGHT_NEARER}), 1.0);
  // Unlit, or the wrong way round: off the screen.
  if (shine <= 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const LIGHT_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColour;
// Over a light map, where light added to the picture would not show: 1 to draw each as a dot of its colour instead.
uniform float uPainted;
out vec4 colour;
void main() {
  vec2 from = gl_PointCoord * 2.0 - 1.0;
  float glow = exp(-dot(from, from) * 3.5) - 0.03;
  if (glow <= 0.0) discard;
  // Added to the picture: light, not paint.
  vec4 light = vec4(vColour.rgb * vColour.a * glow * 1.6, 0.0);
  float spot = clamp(glow * 3.0, 0.0, 1.0) * clamp(vColour.a * 2.0, 0.0, 1.0);
  colour = mix(light, vec4(vColour.rgb * 0.8 * spot, spot), uPainted);
}`;

const SURFACE_VERTEX = `#version 300 es
uniform mat4 uMatrix;
uniform vec3 uEye;
in vec3 aPlace;
in vec4 aOn;
out vec4 vOn;
out float vDistance;
void main() {
  vOn = aOn;
  vDistance = length(uEye - aPlace);
  gl_Position = uMatrix * vec4(mix(aPlace, uEye, ${SURFACE_NEARER}), 1.0);
}`;

const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
// How far across it (metres right of its middle) and along it, how long it is (less than 0 for a taxiway), half its width.
in vec4 vOn;
in float vDistance;
uniform vec3 uRunway;
uniform vec3 uTaxiway;
uniform float uSeen;
out vec4 colour;

// How much of a pixel a stripe covers: \`off\` its middle, \`wide\` half its width, a pixel being \`fine\` metres.
float stripe(float off, float wide, float fine) {
  return clamp((wide - off) / fine + 0.5, 0.0, 1.0) * clamp(2.0 * wide / fine, 0.0, 1.0);
}

void main() {
  float across = abs(vOn.x);
  float fine = max(max(fwidth(vOn.x), fwidth(vOn.y)), 0.01);
  vec3 ground;
  vec3 ink;
  float paint;
  if (vOn.z < 0.0) {
    ground = uTaxiway;
    ink = vec3(0.93, 0.75, 0.16);
    paint = stripe(across, 0.25, fine);
  } else {
    ground = uRunway;
    ink = vec3(0.93);
    // How far from the nearer end.
    float end = min(vOn.y, vOn.z - vOn.y);
    float edge = vOn.w;
    paint = stripe(abs(across - (edge - 1.4)), 0.45, fine);
    // The dashes down the middle, thirty metres on and twenty off; a blur of them once they are finer than the pixels.
    float dash = mix(step(fract(vOn.y / 50.0), 0.6), 0.6, smoothstep(6.0, 20.0, fine));
    paint = max(paint, stripe(across, 0.45, fine) * dash * step(60.0, end));
    // The bars across each end.
    float bars = mix(step(fract(across / 3.6 + 0.25), 0.5), 0.5, smoothstep(0.8, 2.5, fine));
    paint = max(paint, bars * step(6.0, end) * step(end, 36.0) * step(0.9, across) * step(across, edge - 2.6));
    // And the two blocks to aim at, on a runway long enough to have them.
    float aim = step(300.0, end) * step(end, 345.0) * step(edge * 0.28, across) * step(across, edge * 0.56) * step(1400.0, vOn.z);
    paint = max(paint, aim * (1.0 - smoothstep(8.0, 20.0, fine)));
  }
  float seen = 1.0 - smoothstep(uSeen * 0.6, uSeen, vDistance);
  colour = vec4(mix(ground, ink, paint) * seen, seen);
}`;

/** The runways' and the taxiways' colours on the drawn map, light and dark. */
const SURFACES: Record<"light" | "dark", { runway: [number, number, number]; taxiway: [number, number, number] }> = {
  light: { runway: [0.4, 0.42, 0.44], taxiway: [0.56, 0.57, 0.58] },
  dark: { runway: [0.3, 0.32, 0.35], taxiway: [0.22, 0.235, 0.26] },
};

/** One airport as it is drawn. */
interface Drawn {
  /** Its middle, in Mercator's units, and how many of them a metre is there. */
  x: number;
  y: number;
  metre: number;
  lights: Float32Array;
  lightBuffer: WebGLBuffer;
  lightArray: WebGLVertexArrayObject;
  /** Its runways and taxiways, where they are drawn at all. */
  surface: Float32Array | null;
  surfaceBuffer: WebGLBuffer | null;
  surfaceIndices: WebGLBuffer | null;
  surfaceArray: WebGLVertexArrayObject | null;
  surfaceCount: number;
  /** Whether the ground under it has been found yet: drawn at the sea's height it would be under the ground. */
  measured: boolean;
}

/** A runway or a stretch of taxiway as corners and triangles: cross-sections every `step` metres from `from` to `to`. */
function strip(
  corners: number[], triangles: number[], origin: LonLat, from: ArrayLike<number>, to: ArrayLike<number>,
  half: number, step: number, alongFrom: number, length: number,
): number {
  const [east, north] = offsetM(origin[0], origin[1], from[0], from[1]);
  const [toEast, toNorth] = offsetM(origin[0], origin[1], to[0], to[1]);
  const run = Math.hypot(toEast - east, toNorth - north);
  if (run < 0.5) return alongFrom;
  const [ue, un] = [(toEast - east) / run, (toNorth - north) / run];
  const sections = Math.max(1, Math.ceil(run / step));
  const first = corners.length / SURFACE_FLOATS;
  for (let i = 0; i <= sections; i += 1) {
    const along = (run * i) / sections;
    for (const side of [-1, 1]) {
      corners.push(east + ue * along + un * half * side, north + un * along - ue * half * side, 0, half * side, alongFrom + along, length, half);
    }
    if (i === 0) continue;
    const at = first + i * 2;
    triangles.push(at - 2, at - 1, at, at - 1, at + 1, at);
  }
  return alongFrom + run;
}

/** An airport's taxiways, then its runways over them, as corners and triangles. */
function surfaceOf(airport: Airport): { corners: Float32Array; triangles: Uint32Array } {
  const corners: number[] = [];
  const triangles: number[] = [];
  const origin: LonLat = [airport.lon, airport.lat];
  for (const taxiway of airport.taxiways) {
    let along = 0;
    for (let i = 2; i < taxiway.length; i += 2) {
      along = strip(corners, triangles, origin, taxiway.subarray(i - 2, i), taxiway.subarray(i, i + 2), TAXIWAY_HALF_M, TAXIWAY_STEP_M, along, -1);
    }
  }
  for (const runway of airport.runways) {
    strip(corners, triangles, origin, runway.from, runway.to, runway.width / 2, RUNWAY_STEP_M, 0, runway.length);
  }
  return { corners: new Float32Array(corners), triangles: new Uint32Array(triangles) };
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string, attributes: string[]): WebGLProgram {
  const shader = (type: number, source: string) => {
    const made = gl.createShader(type)!;
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(made) ?? "airport shader would not compile");
    return made;
  };
  const program = gl.createProgram()!;
  const shaders = [shader(gl.VERTEX_SHADER, vertex), shader(gl.FRAGMENT_SHADER, fragment)];
  for (const each of shaders) gl.attachShader(program, each);
  attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
  gl.linkProgram(program);
  for (const each of shaders) gl.deleteShader(each);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "airport shader would not link");
  return program;
}

function makeAirportLayer(look: ChartLook): CustomLayerInterface {
  let map: GlMap | null = null;
  let lightProgram: WebGLProgram | null = null;
  let surfaceProgram: WebGLProgram | null = null;
  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  let drawn: Drawn[] = [];
  let version = -1;
  let measuredAt = -Infinity;
  let measuredOn: unknown = null;
  const started = performance.now();
  const colours = SURFACES[look.dark ? "dark" : "light"];

  function drop(gl: WebGL2RenderingContext) {
    for (const airport of drawn) {
      gl.deleteBuffer(airport.lightBuffer);
      gl.deleteVertexArray(airport.lightArray);
      gl.deleteBuffer(airport.surfaceBuffer);
      gl.deleteBuffer(airport.surfaceIndices);
      gl.deleteVertexArray(airport.surfaceArray);
    }
    drawn = [];
  }

  /** Every airport the world holds, as points and triangles on the GPU, their heights still to be measured. */
  function build(gl: WebGL2RenderingContext) {
    drop(gl);
    for (const airport of airportWorld.airports) {
      const origin: LonLat = [airport.lon, airport.lat];
      const lights = new Float32Array(airport.runways.flatMap((runway) => runwayLights(runway, origin)));
      const surface = look.satellite ? null : surfaceOf(airport);
      if (!lights.length && !surface?.triangles.length) continue;
      const lightBuffer = gl.createBuffer()!;
      const lightArray = gl.createVertexArray()!;
      gl.bindVertexArray(lightArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, lights, gl.DYNAMIC_DRAW);
      for (let attribute = 0; attribute < 3; attribute += 1) {
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, LIGHT_FLOATS * 4, attribute * 12);
      }
      const made: Drawn = {
        x: (airport.lon + 180) / 360,
        y: (1 - Math.asinh(Math.tan((airport.lat * Math.PI) / 180)) / Math.PI) / 2,
        metre: 1 / (EARTH_M * Math.cos((airport.lat * Math.PI) / 180)),
        lights, lightBuffer, lightArray,
        surface: null, surfaceBuffer: null, surfaceIndices: null, surfaceArray: null, surfaceCount: 0, measured: false,
      };
      if (surface?.triangles.length) {
        made.surface = surface.corners;
        made.surfaceBuffer = gl.createBuffer()!;
        made.surfaceIndices = gl.createBuffer()!;
        made.surfaceArray = gl.createVertexArray()!;
        made.surfaceCount = surface.triangles.length;
        gl.bindVertexArray(made.surfaceArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, made.surfaceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, surface.corners, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, SURFACE_FLOATS * 4, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SURFACE_FLOATS * 4, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, made.surfaceIndices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.triangles, gl.STATIC_DRAW);
      }
      drawn.push(made);
    }
    gl.bindVertexArray(null);
  }

  /**
   * Put every light and corner at the height of the ground under it, as the
   * map draws it. Where the map draws none there yet, at the mean of what
   * was found of its airport; an airport with none found at all waits.
   */
  function measure(gl: WebGL2RenderingContext, ground: CoverageIndex | null, exaggeration: number) {
    for (const airport of drawn) {
      const lay = (floats: Float32Array, stride: number, lift: number): boolean => {
        let sum = 0;
        let found = 0;
        const missing: number[] = [];
        for (let at = 0; at < floats.length; at += stride) {
          const height = ground ? drawnGround(ground, exaggeration, 0, airport.x + floats[at] * airport.metre, airport.y - floats[at + 1] * airport.metre) : 0;
          if (height === null) {
            missing.push(at);
            continue;
          }
          floats[at + 2] = height + lift;
          sum += height;
          found += 1;
        }
        if (!found) return false;
        for (const at of missing) floats[at + 2] = sum / found + lift;
        return true;
      };
      const lit = !airport.lights.length || lay(airport.lights, LIGHT_FLOATS, LIGHT_LIFT_M);
      const paved = !airport.surface || lay(airport.surface, SURFACE_FLOATS, SURFACE_LIFT_M);
      airport.measured = lit && paved;
      if (!airport.measured) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, airport.lightBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, airport.lights);
      if (airport.surface) {
        gl.bindBuffer(gl.ARRAY_BUFFER, airport.surfaceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, airport.surface);
      }
    }
  }

  return {
    id: FLIGHT_AIRPORTS,
    type: "custom",
    renderingMode: "3d",

    onAdd(added: GlMap, gl: WebGL2RenderingContext) {
      map = added;
      lightProgram = compile(gl, LIGHT_VERTEX, LIGHT_FRAGMENT, ["aPlace", "aColour", "aAim"]);
      surfaceProgram = compile(gl, SURFACE_VERTEX, SURFACE_FRAGMENT, ["aPlace", "aOn"]);
    },

    onRemove(_removed: GlMap, gl: WebGL2RenderingContext) {
      drop(gl);
      gl.deleteProgram(lightProgram);
      gl.deleteProgram(surfaceProgram);
      uniforms.clear();
      lightProgram = null;
      surfaceProgram = null;
      map = null;
      version = -1;
    },

    render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!map || !lightProgram || !surfaceProgram) return;
      const now = performance.now();
      const ground = map.terrain?.getCoverageIndex() ?? null;
      const fresh = version !== airportWorld.version;
      if (fresh) {
        version = airportWorld.version;
        build(gl);
      }
      if (fresh || (ground !== measuredOn && now - measuredAt > MEASURE_MS)) {
        measuredOn = ground;
        measuredAt = now;
        measure(gl, ground, map.terrain?.exaggeration ?? 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
      if (!drawn.length) return;

      const main = options.defaultProjectionData.mainMatrix;
      const back = invert(main);
      if (!back) return;
      const [eyeX, eyeY, eyeZ] = cameraOf(back);
      const fov = (map._camera.transform.fov * Math.PI) / 180;
      const focal = gl.drawingBufferHeight / (2 * Math.tan(fov / 2));

      const uniform = (program: WebGLProgram, name: string) => {
        let at = uniforms.get(program);
        if (!at) uniforms.set(program, at = new Map());
        if (!at.has(name)) at.set(name, gl.getUniformLocation(program, name));
        return at.get(name) ?? null;
      };
      /** Each airport near enough to be seen, with the matrix from its own metres and the eye in them. */
      const each = (program: WebGLProgram, seen: number, draw: (airport: Drawn) => void) => {
        for (const airport of drawn) {
          if (!airport.measured) continue;
          const eye: [number, number, number] = [(eyeX - airport.x) / airport.metre, -(eyeY - airport.y) / airport.metre, eyeZ / airport.metre];
          // Its lights reach a few kilometres from its middle.
          if (Math.hypot(...eye) > seen + 8000) continue;
          const { metre } = airport;
          const matrix = multiply(main, [metre, 0, 0, 0, 0, -metre, 0, 0, 0, 0, metre, 0, airport.x, airport.y, 0, 1]);
          gl.uniformMatrix4fv(uniform(program, "uMatrix"), false, new Float32Array(matrix));
          gl.uniform3f(uniform(program, "uEye"), ...eye);
          draw(airport);
        }
      };

      gl.enable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // Tested against the ground, not written: nothing drawn after is hidden by a light.
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);

      gl.useProgram(surfaceProgram);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform3f(uniform(surfaceProgram, "uRunway"), ...colours.runway);
      gl.uniform3f(uniform(surfaceProgram, "uTaxiway"), ...colours.taxiway);
      gl.uniform1f(uniform(surfaceProgram, "uSeen"), SURFACE_SEEN_M);
      each(surfaceProgram, SURFACE_SEEN_M, (airport) => {
        if (!airport.surfaceArray) return;
        gl.bindVertexArray(airport.surfaceArray);
        gl.drawElements(gl.TRIANGLES, airport.surfaceCount, gl.UNSIGNED_INT, 0);
      });

      gl.useProgram(lightProgram);
      gl.uniform1f(uniform(lightProgram, "uPainted"), look.dark ? 0 : 1);
      gl.uniform1f(uniform(lightProgram, "uTime"), ((now - started) / 1000) % 3600);
      gl.uniform1f(uniform(lightProgram, "uFocal"), focal);
      gl.uniform1f(uniform(lightProgram, "uStretch"), VERTICAL_SCALE);
      gl.uniform1f(uniform(lightProgram, "uSeen"), LIGHTS_SEEN_M);
      let lit = false;
      each(lightProgram, LIGHTS_SEEN_M, (airport) => {
        if (!airport.lights.length) return;
        gl.bindVertexArray(airport.lightArray);
        gl.drawArrays(gl.POINTS, 0, airport.lights.length / LIGHT_FLOATS);
        lit = true;
      });

      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // The flashes go on whether or not the camera moves.
      if (lit) map.triggerRepaint();
    },
  };
}

/** The first of these name properties an airport has, as the map's place names are chosen. */
function airportName(nameKeys: string[]): ExpressionSpecification {
  return ["coalesce", ...[...new Set([...nameKeys, "name"])].map((key) => ["get", key]), ""] as unknown as ExpressionSpecification;
}

function remove(gl: GlMap): void {
  if (gl.getLayer(AIRPORT_NAMES)) gl.removeLayer(AIRPORT_NAMES);
  if (gl.getLayer(FLIGHT_AIRPORTS)) gl.removeLayer(FLIGHT_AIRPORTS);
}

/**
 * Put the airports on the map, in `look`'s palette: their lights and
 * runways over the ground and under the storms, as the water is, and their
 * names under `before` with the peaks'. Anything left of an earlier call
 * goes first, so a new style is simply added to again.
 */
function add(gl: GlMap, look: ChartLook, before?: string): void {
  remove(gl);
  if (!gl.getSource(BASEMAP_SOURCE)) return;
  gl.addLayer(makeAirportLayer(look), drapeAnchor(gl.getStyle().layers));
  const palette = chartPalette(look);
  // The name, and under it the code it is known by and how high it lies, in feet as the altimeter reads.
  const high = ["has", "elevation"];
  gl.addLayer({
    id: AIRPORT_NAMES,
    type: "symbol",
    source: BASEMAP_SOURCE,
    "source-layer": "pois",
    filter: ["==", ["get", "kind"], "aerodrome"] as unknown as FilterSpecification,
    layout: {
      "text-field": [
        "format",
        airportName(look.nameKeys), {},
        "\n", {},
        ["concat",
          ["coalesce", ["get", "iata"], ""],
          ["case", ["all", ["has", "iata"], high], " · ", ""],
          ["case", high, ["concat", ["to-string", ["round", ["*", ["to-number", ["get", "elevation"]], FEET]]], " ft"], ""],
        ],
        { "font-scale": 0.92, "text-font": ["literal", [`${LABEL_FAMILY} Bold`, "sans-serif"]] },
      ] as unknown as ExpressionSpecification,
      "text-font": ["literal", [LABEL_FAMILY, "sans-serif"]] as unknown as string[],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.6],
      "text-max-width": 30,
      "text-padding": 20,
    },
    paint: {
      "text-color": palette.ink,
      "text-halo-color": palette.halo,
      "text-halo-width": palette.haloPx,
    },
  }, before);
}

/** Handed to the 3D map with the rest of the flight's code (support.ts). */
export const airports = { add, remove };
