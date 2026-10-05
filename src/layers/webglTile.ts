import WebGLTileLayer from "ol/layer/WebGLTile";
import type { Options } from "ol/layer/WebGLTile";
import { getContext } from "ol/webgl";

let supported: boolean | undefined;

/**
 * Whether this browser hands out a WebGL context at all.
 *
 * Asked once, of a canvas of its own, which is let go at once: a context is a
 * scarce thing on a phone, and this one was only a question.
 */
export function webglSupported(): boolean {
  if (supported === undefined) {
    const gl = getContext(document.createElement("canvas"));
    supported = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return supported;
}

/**
 * `ol/layer/WebGLTile`, kept out of a browser that has no WebGL to give it.
 *
 * Without a context -- iOS in Lockdown Mode, a GPU the browser has blocked, a
 * headless browser -- OpenLayers throws on every frame trying to set the layer
 * up, and the throw takes the whole frame with it: the basemap went undrawn
 * too, and the map stayed blank. Such a layer is out of view at every
 * resolution instead, so it is never rendered and never asks; the rest of the
 * map draws without it.
 */
export default class TileLayer extends WebGLTileLayer {
  constructor(options: Options) {
    super(options);
    if (!webglSupported()) this.setMaxResolution(0);
  }
}
