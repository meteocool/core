import VectorSource from "ol/source/Vector";
import Layer from "ol/layer/Layer";
import { getUid } from "ol/util";
import { apply as applyTransform } from "ol/transform";
import type { FrameState } from "ol/Map";
import type Point from "ol/geom/Point";
import type Feature from "ol/Feature";
import { DARK_INK, watchInk } from "./casing";
import {
  DASH, DASH_PERIOD, RING_RADIUS, RING_WIDTH, TICK_MS,
} from "../lib/cellPulse";

/**
 * A ring of dashes around every cell still being detected, stepping round it.
 *
 * The tracks layer draws a three-hour window, so most of what is on the map at
 * any moment is a storm that has stopped being detected -- fading, but fading
 * is a comparison: it tells you one mark is older than another and never tells
 * you which ones are live. This is the positive signal.
 *
 * ## Why this is not a vector layer
 *
 * It was one, restyled by a timer five times a second. OpenLayers has no
 * partial redraw: a layer asking to be drawn again is the whole map drawn
 * again -- the WebGL radar, the four clipped network layers, the decluttered
 * labels, the thousands of track features -- and every sheet of glass over it
 * re-blurred, five times a second, for as long as a live cell was in view.
 * That is the one thing a storm map does all afternoon.
 *
 * So the rings are DOM: one small SVG per live cell, placed by this layer's
 * render function whenever the map itself draws, and stepped by a CSS
 * animation in between. The compositor runs that on its own; the map is not
 * involved, and the animation costs nothing when the tab is hidden because
 * the browser pauses it.
 *
 * ## Why it steps rather than sweeps
 *
 * See lib/cellPulse.ts. The ring never changes shape; only the dash pattern's
 * offset moves, one dash-width per tick. Here that is a `steps()` timing
 * function over one dash period, which is the same cycle the tests describe.
 * Every ring is started at the same phase of the wall clock, so they step
 * together: a map where each one runs its own cycle shimmers, where one
 * shared beat reads as the map itself being live.
 */

const SVG = "http://www.w3.org/2000/svg";

/** The class the stylesheet keys on; see global.css. */
export const PULSE_CLASS = "mc-cell-pulse";

/** One dash period, in ms: the CSS animation's duration. */
const CYCLE_MS = TICK_MS * DASH_PERIOD;

/**
 * One ring, phased to the shared beat.
 *
 * A negative delay starts the animation part-way through, at the notch the
 * wall clock says every other ring is on.
 */
function makeRing(): SVGSVGElement {
  const size = (RING_RADIUS + RING_WIDTH) * 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const circle = document.createElementNS(SVG, "circle");
  circle.setAttribute("cx", String(size / 2));
  circle.setAttribute("cy", String(size / 2));
  circle.setAttribute("r", String(RING_RADIUS));
  circle.setAttribute("stroke-dasharray", `${DASH[0]} ${DASH[1]}`);
  circle.style.animationDuration = `${CYCLE_MS}ms`;
  circle.style.animationTimingFunction = `steps(${DASH_PERIOD}, end)`;
  circle.style.animationDelay = `-${Date.now() % CYCLE_MS}ms`;
  svg.appendChild(circle);
  return svg;
}

/**
 * The source to fill with one point per live cell, and the layer that marks it.
 *
 * The returned `stop` takes the basemap subscription down.
 */
export default function makeCellPulseLayer(): [VectorSource<Feature<Point>>, Layer, () => void] {
  const source = new VectorSource<Feature<Point>>();

  const container = document.createElement("div");
  container.className = PULSE_CLASS;
  container.style.setProperty("--mc-pulse-ink", DARK_INK);
  container.style.setProperty("--mc-pulse-period", `${DASH_PERIOD}px`);
  container.style.setProperty("--mc-pulse-width", `${RING_WIDTH}px`);

  /** The ring drawn for each feature, by the feature's uid. */
  const rings = new Map<string, SVGSVGElement>();

  const layer = new Layer({
    source,
    // Under the cell markers at 202, so the ring sits behind the dot rather
    // than over it, and below the mesocyclones at 201 rather than sharing
    // their z and settling it by the order the layers happen to be added in.
    zIndex: 200,
    render(frameState: FrameState) {
      const seen = new Set<string>();
      const half = RING_RADIUS + RING_WIDTH;
      for (const feature of source.getFeatures()) {
        const uid = getUid(feature);
        seen.add(uid);
        let ring = rings.get(uid);
        if (!ring) {
          ring = makeRing();
          rings.set(uid, ring);
          container.appendChild(ring);
        }
        const coordinate = feature.getGeometry()?.getCoordinates();
        if (!coordinate) continue;
        const [x, y] = applyTransform(frameState.coordinateToPixelTransform, coordinate.slice(0, 2));
        ring.style.transform = `translate3d(${x - half}px, ${y - half}px, 0)`;
      }
      for (const [uid, ring] of rings) {
        if (seen.has(uid)) continue;
        ring.remove();
        rings.delete(uid);
      }
      return container;
    },
  });

  /* Light on a dark basemap and dark on a light one; see `inkFor`. The
     contrasting choice rather than the casing one, because this ring is the
     mark: there is no coloured line inside it for a halo to protect, so a
     casing that matched the map would be a dark ring on a dark map. */
  const unwatch = watchInk((next) => {
    container.style.setProperty("--mc-pulse-ink", next);
  });

  return [source, layer, unwatch];
}
