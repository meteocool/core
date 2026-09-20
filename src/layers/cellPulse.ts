import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Circle from "ol/style/Circle";
import type { FeatureLike } from "ol/Feature";
import { DARK_INK, watchInk } from "./casing";
import {
  DASH, DASH_PERIOD, RING_RADIUS, RING_WIDTH, TICK_MS, dashOffset,
} from "../lib/cellPulse";

/**
 * A ring of dashes around every cell still being detected, stepping round it.
 *
 * The tracks layer draws a three-hour window, so most of what is on the map at
 * any moment is a storm that has stopped being detected -- fading, but fading
 * is a comparison: it tells you one mark is older than another and never tells
 * you which ones are live. This is the positive signal.
 *
 * ## Why this is its own layer
 *
 * Anything that moves has to be restyled as it moves, and the cell layer holds
 * every feature of every track in the viewport -- over five thousand in a wide
 * one. OpenLayers keeps a layer's rendered output until something invalidates
 * it, so putting the ring here means the expensive layer is drawn once and
 * this one, holding one point per live cell, is the only thing recomputed.
 *
 * ## Why it steps rather than sweeps
 *
 * See lib/cellPulse.ts. The short version is that the ring never changes
 * shape, so the whole animation is `DASH_PERIOD` prebuilt styles cycled in
 * order at five ticks a second -- against the expanding ping this replaced,
 * which rebuilt every live cell's style twenty times a second and visibly
 * failed to keep up once there were a hundred of them.
 */

const styleCache = new Map<string, Style>();

/**
 * Light on a dark basemap and dark on a light one; see `inkFor`.
 *
 * The contrasting choice rather than the casing one, because this ring is the
 * mark: there is no coloured line inside it for a halo to protect, so a casing
 * that matched the map would be a dark ring on a dark map.
 */
let ink = DARK_INK;

/**
 * The source to fill with one point per live cell, and the layer that marks it.
 *
 * The returned `stop` takes the timer and the basemap subscription down.
 */
export default function makeCellPulseLayer(): [VectorSource, VectorLayer<VectorSource>, () => void] {
  const source = new VectorSource({ features: [] });

  const layer = new VectorLayer({
    source,
    // Under the cell markers at 202, so the ring sits behind the dot rather
    // than over it, and below the mesocyclones at 201 rather than sharing
    // their z and settling it by the order the layers happen to be added in.
    zIndex: 200,
    style: (_feature: FeatureLike) => {
      const offset = dashOffset(Date.now());
      const key = `${ink}:${offset}`;
      let style = styleCache.get(key);
      if (!style) {
        style = new Style({
          image: new Circle({
            radius: RING_RADIUS,
            stroke: new Stroke({
              color: ink,
              width: RING_WIDTH,
              lineDash: [...DASH],
              lineDashOffset: offset,
            }),
          }),
        });
        styleCache.set(key, style);
      }
      return style;
    },
  });

  /**
   * One tick per `TICK_MS`, and only while there is something to tick.
   *
   * It stops when the layer is switched off, the map is scrubbed away from the
   * live edge, no live cells are in view, or the tab is in the background --
   * which is where an animation nobody is looking at costs the most.
   *
   * `prefers-reduced-motion` stops it too. What is left is the ring, dashed and
   * still, which is a perfectly good mark: the rotation says "live" a little
   * faster but the ring is what actually distinguishes the cell, so nothing is
   * lost by holding it.
   */
  const still = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer: ReturnType<typeof setInterval> | null = null;

  const shouldRun = (): boolean => !still
    && layer.getVisible()
    && source.getFeatures().length > 0
    && (typeof document === "undefined" || document.visibilityState === "visible");

  const sync = () => {
    if (shouldRun() && timer === null) {
      timer = setInterval(() => layer.changed(), TICK_MS);
    } else if (!shouldRun() && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  source.on("change", sync);
  layer.on("change:visible", sync);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", sync);
  }
  const unwatch = watchInk((next) => {
    ink = next;
    layer.changed();
  });
  sync();

  return [source, layer, () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    unwatch();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", sync);
    }
  }];
}

export { DASH_PERIOD };
