import VectorSource from "ol/source/Vector";
import Layer from "ol/layer/Layer";
import { getUid } from "ol/util";
import { apply as applyTransform } from "ol/transform";
import type { FrameState } from "ol/Map";
import type Point from "ol/geom/Point";
import type Feature from "ol/Feature";
import { DARK_INK, watchInk } from "./casing";
import {
  DASH, DASH_PERIOD, NOTCH_DEGREES, RING_PATH_LENGTH, RING_RADIUS, RING_WIDTH, TICK_MS, onlySlid,
} from "../lib/cellPulse";
import type { RingLayout } from "../lib/cellPulse";
import { onMapMotion } from "../lib/mapMotion";

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
 * render function whenever the map itself draws (see `render` for how a pan
 * moves them all at once), and stepped by a CSS
 * animation in between. The animation turns the SVG rather than moving its
 * dashes, because a transform is the one thing the compositor animates on its
 * own: the page does no style, layout or paint per tick, the map is not
 * involved, and the browser pauses it while the tab is hidden. The dash
 * offset it used to animate cannot be composited, and repainted every ring on
 * the main thread every frame, map at rest or not.
 *
 * ## Why it steps rather than sweeps
 *
 * See lib/cellPulse.ts. The ring never changes shape; it turns one dash-width
 * per tick. Here that is a `steps()` timing function over a turn of one dash
 * period, which is the same cycle the tests describe.
 * Every ring is started at the same phase of the wall clock, so they step
 * together: a map where each one runs its own cycle shimmers, where one
 * shared beat reads as the map itself being live.
 */

const SVG = "http://www.w3.org/2000/svg";

/** The class the stylesheet keys on; see global.css. */
export const PULSE_CLASS = "mc-cell-pulse";

/** On the container while the map moves: the rings hold still. */
const STILL_CLASS = "mc-still";

/** One dash period, in ms: the CSS animation's duration. */
const CYCLE_MS = TICK_MS * DASH_PERIOD;

/** The delay that starts a ring's animation on the notch the wall clock is at. */
const onTheBeat = () => `-${Date.now() % CYCLE_MS}ms`;

/**
 * One ring, phased to the shared beat.
 *
 * Two elements, because two things move it: the map places the outer one,
 * a transform written on every map frame, and the animation turns the inner
 * one. On a single element the two transforms would overwrite each other.
 *
 * A negative delay starts the animation part-way through, at the notch the
 * wall clock says every other ring is on.
 */
function makeRing(): HTMLDivElement {
  const size = (RING_RADIUS + RING_WIDTH) * 2;
  const ring = document.createElement("div");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.style.animationDuration = `${CYCLE_MS}ms`;
  svg.style.animationTimingFunction = `steps(${DASH_PERIOD}, end)`;
  svg.style.animationDelay = onTheBeat();
  const circle = document.createElementNS(SVG, "circle");
  circle.setAttribute("cx", String(size / 2));
  circle.setAttribute("cy", String(size / 2));
  circle.setAttribute("r", String(RING_RADIUS));
  circle.setAttribute("pathLength", String(RING_PATH_LENGTH));
  circle.setAttribute("stroke-dasharray", `${DASH[0]} ${DASH[1]}`);
  svg.appendChild(circle);
  ring.appendChild(svg);
  return ring;
}

/**
 * The source to fill with one point per live cell, and the layer that marks it.
 *
 * The returned `stop` takes the basemap and map-motion subscriptions down.
 */
export default function makeCellPulseLayer(): [VectorSource<Feature<Point>>, Layer, () => void] {
  const source = new VectorSource<Feature<Point>>();

  const container = document.createElement("div");
  container.className = PULSE_CLASS;
  container.style.setProperty("--mc-pulse-ink", DARK_INK);
  container.style.setProperty("--mc-pulse-turn", `${DASH_PERIOD * NOTCH_DEGREES}deg`);
  container.style.setProperty("--mc-pulse-width", `${RING_WIDTH}px`);

  /*
   * The rings sit on a pane of their own inside the container. The container
   * stays put and clips to the map; the pane is what a pan slides.
   */
  const pane = document.createElement("div");
  container.appendChild(pane);

  /** The ring drawn for each feature, by the feature's uid. */
  const rings = new Map<string, HTMLDivElement>();

  /**
   * The layout the rings are in, and the map coordinate that was at the
   * pane's top-left corner when they were laid out.
   */
  let laid: RingLayout | null = null;
  let anchor: number[] = [0, 0];
  let paneTransform = "";

  /** Put every ring where its cell is on screen, with the pane back at the corner. */
  const layOut = (frameState: FrameState) => {
    const seen = new Set<string>();
    const half = RING_RADIUS + RING_WIDTH;
    anchor = applyTransform(frameState.pixelToCoordinateTransform, [0, 0]);
    if (paneTransform) pane.style.transform = paneTransform = "";
    for (const feature of source.getFeatures()) {
      const uid = getUid(feature);
      seen.add(uid);
      let ring = rings.get(uid);
      if (!ring) {
        ring = makeRing();
        rings.set(uid, ring);
        pane.appendChild(ring);
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
  };

  const layer = new Layer({
    source,
    // Under the cell markers at 202, so the ring sits behind the dot rather
    // than over it, and below the mesocyclones at 201 rather than sharing
    // their z and settling it by the order the layers happen to be added in.
    zIndex: 200,
    /*
     * Every frame of a pan used to write a new position onto every ring: a
     * style change per ring per frame, each ring its own compositor layer, so
     * the page restyled and rebuilt its layers on every frame -- about a
     * millisecond a frame on a mid-range phone with three rings, and a storm
     * afternoon has dozens. A pan moves every ring by the same amount, so
     * then only the pane moves; the rings are laid out afresh when the zoom,
     * the rotation or the set of cells changes.
     */
    render(frameState: FrameState) {
      const { resolution, rotation } = frameState.viewState;
      const now: RingLayout = { resolution, rotation, revision: source.getRevision() };
      if (onlySlid(laid, now)) {
        const [x, y] = applyTransform(frameState.coordinateToPixelTransform, anchor.slice());
        const transform = `translate3d(${x}px, ${y}px, 0)`;
        if (transform !== paneTransform) pane.style.transform = paneTransform = transform;
        return container;
      }
      layOut(frameState);
      laid = now;
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

  /*
   * The rings hold still while the map moves. They step on the compositor and
   * cost nothing at rest, but whenever the page draws a frame -- every frame
   * of a pan, as the map redraws -- the browser restyles every running
   * animation: with sixty live cells that was most of the styling in a pan.
   * Paused on the notch they are at, and on the way back each one is put on
   * the notch the clock is at, as a new ring would be, so the map keeps one
   * beat.
   */
  const unlisten = onMapMotion((moving) => {
    if (moving) {
      container.classList.add(STILL_CLASS);
      return;
    }
    const delay = onTheBeat();
    for (const ring of rings.values()) {
      const svg = ring.firstElementChild as SVGSVGElement | null;
      if (svg) svg.style.animationDelay = delay;
    }
    container.classList.remove(STILL_CLASS);
  });

  return [source, layer, () => {
    unwatch();
    unlisten();
  }];
}
