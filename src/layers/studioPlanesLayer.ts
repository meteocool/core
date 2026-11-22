/**
 * Studio's section planes, drawn standing on the 3D map.
 *
 * A cut shows what is left of a storm, not where the plane is: with nothing
 * cut yet, or with the plane out in clear air, there is nothing on screen to
 * say where it stands or which way it faces. So each is drawn as a CAD
 * program draws one: a faint sheet with an outline, the one being worked on
 * brighter than the rest, and a slab's far face as an outline of its own.
 *
 * A custom layer of its own rather than part of the clouds': it is a dozen
 * triangles with nothing to march, and it comes and goes with Studio.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GlMap } from "maplibre-gl";
import { isLevel, mercatorOf, normalOf, PLANE_TOP_KM } from "../lib/studio/planes";
import type { SectionPlane } from "../lib/studio/planes";
import { VERTICAL_SCALE } from "./terrain";

/** The Earth around the equator, in metres: what Mercator's unit is worth there. */
const EARTH_M = 40075016.686;

/** How much of the view's width a sheet spans to either side of its point. */
const SHEET_SHARE = 0.3;

/** Studio's accent, which its chrome is drawn in too (Studio.svelte). */
const ACCENT: [number, number, number] = [1.0, 0.62, 0.11];

const VERTEX = `#version 300 es
uniform mat4 uMatrix;
in vec3 aPosition;
void main() {
  gl_Position = uMatrix * vec4(aPosition, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 uColour;
out vec4 fragColour;
void main() {
  fragColour = uColour;
}`;

type Vec3 = [number, number, number];

/**
 * The four corners of a plane's sheet, in kilometres east, north and up of
 * its point: as wide as `halfKm` to either side, and from the ground to the
 * top of the tallest storm, or as deep as it is wide where it lies level.
 */
export function sheetCorners(plane: SectionPlane, halfKm: number): Vec3[] {
  const facing = (plane.facingDeg * Math.PI) / 180;
  const normal = normalOf(plane);
  // Along the plane on the ground, then the other way across it: up it, for a wall.
  const along: Vec3 = [Math.cos(facing), -Math.sin(facing), 0];
  const across: Vec3 = [
    normal[1] * along[2] - normal[2] * along[1],
    normal[2] * along[0] - normal[0] * along[2],
    normal[0] * along[1] - normal[1] * along[0],
  ];
  // From the ground to the top where it stands up enough to reach both.
  const rises = Math.abs(across[2]) > 0.2;
  const [low, high] = rises
    ? [(0 - plane.heightKm) / across[2], (PLANE_TOP_KM - plane.heightKm) / across[2]].sort((a, b) => a - b)
    : [-halfKm, halfKm];
  const corner = (a: number, b: number): Vec3 => [
    along[0] * a + across[0] * b, along[1] * a + across[1] * b, along[2] * a + across[2] * b,
  ];
  return [corner(-halfKm, low), corner(halfKm, low), corner(halfKm, high), corner(-halfKm, high)];
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export interface StudioPlanesLayer extends CustomLayerInterface {
  /**
   * The planes to draw, and which of them is being worked on; as wide as
   * `halfKm` to either side where that is given, else by the view.
   */
  setPlanes(planes: readonly SectionPlane[], selected: number | null, halfKm?: number): void;
}

export function makeStudioPlanesLayer(id: string): StudioPlanesLayer {
  let map: GlMap | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let planes: readonly SectionPlane[] = [];
  let selected: number | null = null;
  let fixedHalfKm: number | null = null;

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    setPlanes(next, chosen, halfKm) {
      planes = next;
      selected = chosen;
      fixedHalfKm = halfKm ?? null;
      if (map?.getContainer().isConnected) map.triggerRepaint();
    },

    onAdd(added: GlMap, gl: WebGL2RenderingContext) {
      map = added;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? "plane shader would not compile");
        }
        return shader;
      };
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.bindAttribLocation(program, 0, "aPosition");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "plane shader would not link");
      }
      buffer = gl.createBuffer();
      vertexArray = gl.createVertexArray();
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    },

    render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!program || !map || !planes.length) return;
      const main = options.defaultProjectionData.mainMatrix;
      const { lat } = map.getCenter();
      // The ground the view spans, in kilometres, which the sheets are sized by.
      const acrossKm = ((EARTH_M / 1000) * Math.cos((lat * Math.PI) / 180) * map.getContainer().clientWidth)
        / (512 * 2 ** map.getZoom());
      const halfKm = fixedHalfKm ?? Math.min(Math.max(acrossKm * SHEET_SHARE, 4), 400);

      gl.useProgram(program);
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      const matrixAt = gl.getUniformLocation(program, "uMatrix");
      const colourAt = gl.getUniformLocation(program, "uColour");
      const paint = (alpha: number) => gl.uniform4f(colourAt, ACCENT[0] * alpha, ACCENT[1] * alpha, ACCENT[2] * alpha, alpha);

      for (const plane of planes) {
        const chosen = plane.id === selected;
        const dim = plane.enabled ? 1 : 0.4;
        const [x, y] = mercatorOf(plane.lon, plane.lat);
        // Mercator units to the metre, here; south is down the map, and up is stretched as the storms are.
        const metre = 1 / (EARTH_M * Math.cos((plane.lat * Math.PI) / 180));
        const km = 1000 * metre;
        // Drawn around the plane's own point, so its corners are small numbers in single precision.
        const local = multiply(main, [
          km, 0, 0, 0,
          0, -km, 0, 0,
          0, 0, km * VERTICAL_SCALE, 0,
          x, y, plane.heightKm * km * VERTICAL_SCALE, 1,
        ]);
        gl.uniformMatrix4fv(matrixAt, false, new Float32Array(local));

        const corners = sheetCorners(plane, isLevel(plane) ? halfKm * 0.6 : halfKm);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners.flat()), gl.DYNAMIC_DRAW);
        paint((chosen ? 0.12 : 0.04) * dim);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        paint((chosen ? 0.95 : 0.45) * dim);
        gl.drawArrays(gl.LINE_LOOP, 0, 4);

        if (plane.slabKm !== null) {
          // The slab's far face: the same sheet, a thickness back along the normal.
          const normal = normalOf(plane);
          const back = corners.map((corner) => corner.map((value, axis) => value - normal[axis] * plane.slabKm!));
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(back.flat()), gl.DYNAMIC_DRAW);
          paint((chosen ? 0.6 : 0.3) * dim);
          gl.drawArrays(gl.LINE_LOOP, 0, 4);
        }
      }

      gl.bindVertexArray(null);
      gl.depthMask(true);
    },

    onRemove(_removed: GlMap, gl: WebGL2RenderingContext) {
      if (buffer) gl.deleteBuffer(buffer);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (program) gl.deleteProgram(program);
      buffer = null;
      vertexArray = null;
      program = null;
      map = null;
    },
  };
}
