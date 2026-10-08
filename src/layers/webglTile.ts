import WebGLTileLayer from "ol/layer/WebGLTile";
import type { Options } from "ol/layer/WebGLTile";
import type { FrameState } from "ol/Map";
import { getContext } from "ol/webgl";

let supported: boolean | undefined;

/**
 * Whether this browser hands out a WebGL context at all.
 *
 * Asked once, on a canvas of its own whose context is released right away,
 * since contexts are scarce on a phone.
 */
export function webglSupported(): boolean {
  if (supported === undefined) {
    const gl = getContext(document.createElement("canvas"));
    supported = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return supported;
}

/** How long a layer waits to try again while its WebGL context is lost. */
const CONTEXT_RETRY_MS = 1000;

/**
 * Canvases the page has seen lose their WebGL context, for as long as they are
 * still on it and still without one. Captured at the window because the event
 * does not bubble, and the canvas a failing layer was about to draw with is
 * not always one it can be asked about (see `TileLayer.render`).
 */
const lostCanvases = new Set<HTMLCanvasElement>();

if (typeof window !== "undefined") {
  window.addEventListener("webglcontextlost", (event) => {
    if (event.target instanceof HTMLCanvasElement) lostCanvases.add(event.target);
  }, true);
}

/** The canvas's existing context; asking for the other kind creates nothing. */
const contextOf = (canvas: HTMLCanvasElement) => (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;

function aContextIsLost(): boolean {
  for (const canvas of lostCanvases) {
    if (!canvas.isConnected || !contextOf(canvas)?.isContextLost()) lostCanvases.delete(canvas);
  }
  return lostCanvases.size > 0;
}

/**
 * `ol/layer/WebGLTile`, kept out of a browser that has no WebGL to give it,
 * and drawing nothing while its context is lost.
 *
 * Without a context (iOS in Lockdown Mode, a GPU the browser has blocked, a
 * headless browser), OpenLayers throws on every frame trying to set the layer
 * up, and the throw takes the whole frame with it: the basemap goes undrawn
 * too, and the map stays blank. So such a layer is out of view at every
 * resolution, is never rendered and never asks; the rest of the map draws
 * without it.
 */
export default class TileLayer extends WebGLTileLayer {
  private contextRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(options: Options) {
    super(options);
    if (!webglSupported()) this.setMaxResolution(0);
  }

  /**
   * A layer set up while its context is lost (a new frame's layer, or one
   * rebuilt after its map was hidden, while the GPU is being reset or the
   * phone has taken the context back) cannot compile its shaders, and
   * OpenLayers throws on every frame until the context returns: "shader
   * compilation failed", then `ol_uid` of the program it never made, or on
   * Safari `shaderSource` given the null `createShader` hands back. Every
   * throw takes the rest of the frame down too.
   *
   * So such a layer draws nothing for the moment, the rest of the map draws,
   * and it asks again shortly: once the browser restores the context,
   * OpenLayers builds the layer afresh. Anything else thrown is still thrown.
   */
  override render(frameState: FrameState | null, target: HTMLElement): HTMLElement {
    try {
      return super.render(frameState, target);
    } catch (error) {
      if (!this.contextLost()) throw error;
      this.contextRetry ??= setTimeout(() => {
        this.contextRetry = null;
        this.changed();
      }, CONTEXT_RETRY_MS);
      // What the composite renderer gets from a layer that drew nothing new.
      return target;
    }
  }

  private contextLost(): boolean {
    const renderer = this.hasRenderer()
      ? this.getRenderer() as unknown as { helper?: { getGL(): WebGLRenderingContext } }
      : null;
    return renderer?.helper?.getGL().isContextLost() === true || aContextIsLost();
  }

  override disposeInternal(): void {
    if (this.contextRetry !== null) clearTimeout(this.contextRetry);
    this.contextRetry = null;
    super.disposeInternal();
  }
}
