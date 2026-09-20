import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Circle from "ol/style/Circle";
import type { FeatureLike } from "ol/Feature";
import { severityColour } from "./cells";
import { pulseRing, pulseStep, STEPS } from "../lib/cellPulse";

/**
 * A slow ping on the cells that are still being detected.
 *
 * The tracks layer draws a three-hour window, so most of what is on the map at
 * any moment is a storm that has stopped being detected -- fading, but fading
 * is a comparison: it tells you one mark is older than another and never tells
 * you which ones are live. This is the positive signal. A ring expands out of
 * each active centroid and fades, once every couple of seconds, which is the
 * oldest "this is live" idiom there is and needs no legend.
 *
 * ## Why this is its own layer
 *
 * An animation has to re-run the style function every frame, and the cell
 * layer holds every feature of every track in the viewport -- a busy afternoon
 * is a couple of thousand. OpenLayers keeps a layer's rendered output until
 * something invalidates it, so putting the ping here means the expensive layer
 * is drawn once and this one, holding one point per live cell, is the only
 * thing recomputed.
 *
 * ## Why it is not a blink
 *
 * Flashing is the one thing interface guidance is unanimous about, and a map
 * someone watches through a severe afternoon is the worst place for it. An
 * expanding ring carries the same "live" reading with no luminance flicker,
 * and it degrades honestly: under `prefers-reduced-motion` the ring stops
 * moving and stays as a static halo, so the distinction survives without the
 * animation carrying it.
 */

/** Redraws per second. Fast enough to be smooth, slow enough to be cheap. */
const FPS = 20;

const styleCache = new Map<string, Style>();

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha.toFixed(3)})`;
};

const reducedMotion = (): boolean => typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The source to fill with one point per live cell, and the layer that pings it.
 *
 * The returned `stop` takes the timer down; nothing in this app tears the map
 * back down today, but a layer that keeps a 20 Hz timer alive after it is gone
 * is the kind of thing that only shows up as a battery complaint.
 */
export default function makeCellPulseLayer(): [VectorSource, VectorLayer<VectorSource>, () => void] {
  const source = new VectorSource({ features: [] });
  const still = reducedMotion();

  const layer = new VectorLayer({
    source,
    // Under the cell markers at 202, so the ring comes out from behind the dot
    // rather than over it -- the dot is the thing being pointed at. Below the
    // mesocyclones at 201 as well, rather than sharing their z and settling it
    // by the order the layers happen to be added in.
    zIndex: 200,
    style: (feature: FeatureLike) => {
      const severity = feature.get("max_severity") ?? 0;
      // Held still, the ring is a halo at the point in the cycle where it is
      // clearest: close to the marker, at full strength.
      const step = still ? 0 : pulseStep(Date.now());
      const key = `${severity}:${step}`;
      let style = styleCache.get(key);
      if (!style) {
        const { radius, alpha } = pulseRing(step / STEPS);
        style = new Style({
          image: new Circle({
            radius,
            stroke: new Stroke({ color: rgba(severityColour(severity), alpha), width: 2 }),
          }),
        });
        styleCache.set(key, style);
      }
      return style;
    },
  });

  /**
   * Driven by a timer rather than by chaining renders off `postrender`.
   *
   * That idiom runs at whatever rate the display offers and gives nothing to
   * throttle with; this one sets the rate, and stops entirely when there is
   * nothing to animate -- the layer switched off, the map scrubbed away from
   * the live edge, no live cells in view, or the tab in the background, which
   * is where an animation nobody is looking at costs the most.
   */
  let timer: ReturnType<typeof setInterval> | null = null;

  const shouldRun = (): boolean => !still
    && layer.getVisible()
    && source.getFeatures().length > 0
    && (typeof document === "undefined" || document.visibilityState === "visible");

  const sync = () => {
    if (shouldRun() && timer === null) {
      timer = setInterval(() => layer.changed(), 1000 / FPS);
    } else if (!shouldRun() && timer !== null) {
      clearInterval(timer);
      timer = null;
      // One last redraw, or the ring is left frozen mid-expansion.
      layer.changed();
    }
  };

  source.on("change", sync);
  layer.on("change:visible", sync);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", sync);
  }
  sync();

  return [source, layer, () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", sync);
    }
  }];
}
