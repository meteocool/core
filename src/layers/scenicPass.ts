/**
 * What a scenic sky draws besides its clouds' shape (cellVolumeLayer's
 * `ScenicPass`): its sun, and the smaller picture its clouds are drawn in
 * before they are laid over the map.
 *
 * Studio's flight has such a sky and brings this with it: the storm layer
 * is the map's, loaded by everyone who opens it, and none of this is.
 */
import { apply, compile, invert, type Mat4, type ScenicPass } from "./cellVolumeLayer";

/*
 * The sun: a disc and its glare, in the open sky only.
 *
 * Drawn at the far end of the depth range, so the ground hides it, and
 * before the clouds, so they do. Where it is in the picture comes from the
 * four rays through the picture's corners, worked out outside the shader:
 * on the map a ray's two ends differ by a few millionths, which a shader's
 * floats lose.
 */
const SUN_VERTEX = `#version 300 es
out vec2 vAt;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vAt = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 1.0, 1.0);
}`;

const SUN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
uniform vec3 uRay[4];   // bottom left, bottom right, top left, top right
uniform vec3 uSun;
out vec4 colour;
void main() {
  vec3 ray = normalize(mix(mix(uRay[0], uRay[1], vAt.x), mix(uRay[2], uRay[3], vAt.x), vAt.y));
  float towards = max(dot(ray, uSun), 0.0);
  float disc = smoothstep(0.99972, 0.99988, towards);
  // Its glare: tight round the disc, and a wide faint one that whitens that quarter of the sky.
  float glare = 0.5 * pow(towards, 700.0) + 0.17 * pow(towards, 70.0) + 0.06 * pow(towards, 9.0);
  colour = vec4(vec3(1.0, 0.96, 0.88) * (disc * 1.3 + glare), 0.0);
}`;

/* A picture drawn somewhere else, laid over this one: the clouds, which are drawn smaller and stretched. */
const LAY_VERTEX = `#version 300 es
out vec2 vAt;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vAt = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const LAY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
uniform sampler2D uPicture;
out vec4 colour;
void main() { colour = texture(uPicture, vAt); }`;

/** Where the sun of the white cloud stands (the cloud shader's `SUN`): east, north and up. */
const SUN_DIRECTION: [number, number, number] = [-0.8, -0.25, 0.55];

function link(context: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = context.createProgram()!;
  context.attachShader(program, compile(context, context.VERTEX_SHADER, vertex));
  context.attachShader(program, compile(context, context.FRAGMENT_SHADER, fragment));
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    throw new Error(context.getProgramInfoLog(program) ?? "scenic pass would not link");
  }
  return program;
}

export function makeScenicPass(context: WebGL2RenderingContext): ScenicPass {
  const sunProgram = link(context, SUN_VERTEX, SUN_FRAGMENT);
  const layProgram = link(context, LAY_VERTEX, LAY_FRAGMENT);
  /**
   * Where the clouds are drawn before they are laid over the map: a picture
   * of their own, smaller than the map's. Their shader is several times the
   * map's own, and a cloud has no edge that a half-size picture loses; with
   * the map's depths copied into it, the ground still hides them. `false`
   * once a machine has refused it: then they are drawn straight onto the
   * map, at its size and cost.
   */
  let aside: { framebuffer: WebGLFramebuffer; picture: WebGLTexture; depth: WebGLRenderbuffer; width: number; height: number } | false | null = null;
  let tried = false;

  function drop(): void {
    if (!aside) return;
    context.deleteFramebuffer(aside.framebuffer);
    context.deleteTexture(aside.picture);
    context.deleteRenderbuffer(aside.depth);
    aside = null;
  }

  /** The picture, made or made again for the map's size; null where there is to be none. */
  function asideFor(width: number, height: number) {
    if (aside === false) return null;
    if (aside && aside.width === width && aside.height === height) return aside;
    drop();
    const picture = context.createTexture()!;
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, picture);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, width, height, 0, context.RGBA, context.UNSIGNED_BYTE, null);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.bindTexture(context.TEXTURE_2D, null);
    const depth = context.createRenderbuffer()!;
    context.bindRenderbuffer(context.RENDERBUFFER, depth);
    context.renderbufferStorage(context.RENDERBUFFER, context.DEPTH24_STENCIL8, width, height);
    context.bindRenderbuffer(context.RENDERBUFFER, null);
    const framebuffer = context.createFramebuffer()!;
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, picture, 0);
    context.framebufferRenderbuffer(context.FRAMEBUFFER, context.DEPTH_STENCIL_ATTACHMENT, context.RENDERBUFFER, depth);
    const whole = context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    aside = { framebuffer, picture, depth, width, height };
    tried = false;
    if (!whole) {
      drop();
      aside = false;
      return null;
    }
    return aside;
  }

  return {
    drawSun(main: Mat4) {
      const back = invert(main);
      if (!back) return;
      // The ray through each corner of the picture, on the map: east, south (as its y runs) and up.
      const rays = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).flatMap(([x, y]) => {
        const [nx, ny, nz, nw] = apply(back, x, y, -1);
        const [fx, fy, fz, fw] = apply(back, x, y, 1);
        const ray = [fx / fw - nx / nw, fy / fw - ny / nw, fz / fw - nz / nw];
        const length = Math.hypot(...ray) || 1;
        return ray.map((part) => part / length);
      });
      const [east, north, up] = SUN_DIRECTION;
      const length = Math.hypot(east, north, up);
      context.useProgram(sunProgram);
      context.uniform3fv(context.getUniformLocation(sunProgram, "uRay"), new Float32Array(rays));
      context.uniform3f(context.getUniformLocation(sunProgram, "uSun"), east / length, -north / length, up / length);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LEQUAL);
      context.depthMask(false);
      context.disable(context.CULL_FACE);
      context.disable(context.SCISSOR_TEST);
      context.enable(context.BLEND);
      context.blendFunc(context.ONE, context.ONE);
      context.drawArrays(context.TRIANGLES, 0, 3);
    },

    begin(mapWidth, mapHeight, scale) {
      const width = Math.max(1, Math.ceil(mapWidth * scale));
      const height = Math.max(1, Math.ceil(mapHeight * scale));
      const apart = asideFor(width, height);
      if (!apart) return null;
      // The map's depths, so its ground hides the clouds behind it there as it would here.
      context.bindFramebuffer(context.READ_FRAMEBUFFER, null);
      context.bindFramebuffer(context.DRAW_FRAMEBUFFER, apart.framebuffer);
      context.blitFramebuffer(0, 0, mapWidth, mapHeight, 0, 0, width, height, context.DEPTH_BUFFER_BIT, context.NEAREST);
      if (!tried) {
        // Asked once: a machine that will not copy depths between the two says so here.
        tried = true;
        if (context.getError() !== context.NO_ERROR) {
          context.bindFramebuffer(context.FRAMEBUFFER, null);
          drop();
          aside = false;
          return null;
        }
      }
      context.bindFramebuffer(context.FRAMEBUFFER, apart.framebuffer);
      context.viewport(0, 0, width, height);
      context.disable(context.SCISSOR_TEST);
      context.colorMask(true, true, true, true);
      context.clearColor(0, 0, 0, 0);
      context.clear(context.COLOR_BUFFER_BIT);
      return { width, height };
    },

    end(mapWidth, mapHeight) {
      if (!aside) return;
      // Back onto the map, stretched: the ground has had its say already.
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.viewport(0, 0, mapWidth, mapHeight);
      context.disable(context.DEPTH_TEST);
      context.useProgram(layProgram);
      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, aside.picture);
      context.uniform1i(context.getUniformLocation(layProgram, "uPicture"), 0);
      context.drawArrays(context.TRIANGLES, 0, 3);
      context.bindTexture(context.TEXTURE_2D, null);
    },

    dispose() {
      drop();
      context.deleteProgram(sunProgram);
      context.deleteProgram(layProgram);
    },
  };
}
