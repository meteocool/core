/**
 * Make OpenLayers give back a WebGL layer's screen-sized target when the
 * layer lets its renderer go.
 *
 * Each WebGL layer draws through a post-processing pass of its own, which
 * holds a texture and a depth buffer the size of the map's canvas, 15 MB at
 * an iPhone's 3x. OpenLayers 10's helper never deletes them on dispose, and
 * the layers of a map share one context, so every renderer a layer drops
 * (a map hidden a while, a layer replaced) left them on the GPU for as long
 * as any other layer kept that context.
 */
import WebGLHelper from "ol/webgl/Helper";

/** What a post-processing pass holds on the GPU, by OpenLayers' private names. */
export interface PassResources {
  renderTargetTexture_?: WebGLTexture | null;
  frameBuffer_?: WebGLFramebuffer | null;
  depthBuffer_?: WebGLRenderbuffer | null;
  renderTargetProgram_?: WebGLProgram | null;
  renderTargetVerticesBuffer_?: WebGLBuffer | null;
}

type Deleting = Pick<WebGLRenderingContext,
  "deleteTexture" | "deleteFramebuffer" | "deleteRenderbuffer" | "deleteProgram" | "deleteBuffer" | "isContextLost">;

/** Delete what the passes hold, unless the context has gone, and with it all of it. */
export function deletePasses(gl: Deleting | undefined, passes: readonly PassResources[] | undefined): void {
  if (!gl || !passes || gl.isContextLost()) return;
  for (const pass of passes) {
    if (pass.renderTargetTexture_) gl.deleteTexture(pass.renderTargetTexture_);
    if (pass.frameBuffer_) gl.deleteFramebuffer(pass.frameBuffer_);
    if (pass.depthBuffer_) gl.deleteRenderbuffer(pass.depthBuffer_);
    if (pass.renderTargetProgram_) gl.deleteProgram(pass.renderTargetProgram_);
    if (pass.renderTargetVerticesBuffer_) gl.deleteBuffer(pass.renderTargetVerticesBuffer_);
    pass.renderTargetTexture_ = null;
    pass.frameBuffer_ = null;
    pass.depthBuffer_ = null;
    pass.renderTargetProgram_ = null;
    pass.renderTargetVerticesBuffer_ = null;
  }
}

interface HelperInternals {
  gl_?: WebGLRenderingContext;
  postProcessPasses_?: PassResources[];
  disposeInternal(): void;
}

let installed = false;

/** Patch the helper once, before any map is drawn. */
export function releasePassesOnDispose(): void {
  if (installed) return;
  installed = true;
  const proto = WebGLHelper.prototype as unknown as HelperInternals;
  const dispose = proto.disposeInternal;
  proto.disposeInternal = function disposeInternal(this: HelperInternals) {
    deletePasses(this.gl_, this.postProcessPasses_);
    dispose.call(this);
  };
}
