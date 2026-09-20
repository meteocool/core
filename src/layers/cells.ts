import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Circle from "ol/style/Circle";
import Text from "ol/style/Text";
import type { FeatureLike } from "ol/Feature";
import { mapBaseLayer, selectedCell } from "../stores";
import { outlineIsCurrent } from "../lib/cellGeometry";

/**
 * Tracked thunderstorm cells: where each one has been, and where it is going.
 *
 * Five kinds of feature make up one cell, drawn from the same source so they
 * share a visibility toggle and a z-order: the path it has taken, its current
 * position, its outline, and the forecast centroids with the uncertainty
 * ellipse around each.
 *
 * ## What is drawn, and when
 *
 * The forecast is the loudest thing a cell owns and the least often wanted.
 * Each one carries a dozen predicted centroids and a nested ellipse per step,
 * and a busy afternoon over Germany puts two hundred cells on screen: the
 * result was some two and a half thousand dots and a couple of hundred large
 * dashed ellipses laid over each other, which buried the radar the tracks are
 * there to be compared against.
 *
 * So a cell at rest draws only what it has actually done -- where it has been,
 * where it is, and its outline -- and the whole predicted sequence appears for
 * the one cell whose popup is open. The map stays readable, and the detail is
 * a tap away rather than permanently spread across every storm at once.
 */

/** DWD's severity classes, in the colours their own charts use. */
const SEVERITY_COLOURS = ["#2f9e44", "#f0b429", "#e03131", "#9c36b5"];

export type CellFeatureKind = "path" | "cell" | "outline" | "forecast" | "ellipse";

const severityColour = (severity: number): string => SEVERITY_COLOURS[Math.min(Math.max(severity, 0), 3)];

/**
 * A track fades once its cell stops being detected.
 *
 * Without this a map left open through an afternoon fills up with storms that
 * dissipated an hour ago, all drawn as confidently as the live ones.
 */
const ageOpacity = (minutes: number): number => {
  if (minutes < 20) return 1;
  if (minutes < 40) return 0.6;
  if (minutes < 60) return 0.35;
  return 0.15;
};

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * The one thing about a cell worth seeing from across the map.
 *
 * Rotation first: a mesocyclone is the signature that separates a severe storm
 * from a heavy shower, and it is rarer than hail.
 */
const badge = (feature: FeatureLike): string => {
  if (feature.get("meso_ever")) return "↻";
  if (feature.get("hail_ever")) return "✦";
  return "";
};

const styleCache = new Map<string, Style | Style[]>();

/**
 * The cell whose popup is open, or null.
 *
 * Held here rather than passed in because OpenLayers calls a style function
 * per feature per frame and has nowhere to thread state through it. The
 * subscription that maintains it also has to tell the layer to redraw --
 * nothing else changes when a selection does, so without that the map keeps
 * the styles it last worked out.
 */
let selectedCode: string | null = null;

/**
 * Styles are shared by every feature that looks the same, as the other layers
 * do. A mark drawn as a casing plus a line caches as the pair, so the two
 * halves cannot drift apart or be built separately per feature.
 */
function cached<T extends Style | Style[]>(key: string, build: () => T): T {
  let style = styleCache.get(key);
  if (!style) {
    style = build();
    styleCache.set(key, style);
  }
  return style as T;
}

/** Opacity is bucketed so the cache has a handful of entries rather than one per cell. */
const bucket = (opacity: number): number => Math.round(opacity * 10) / 10;

function pathStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(feature.get("age_minutes") ?? 0));
  const picked = isSelected(feature);
  return cached(`path:${severity}:${opacity}:${picked}`, () => new Style({
    stroke: new Stroke({
      color: rgba(severityColour(severity), picked ? 1 : opacity),
      width: (picked ? 3 : 2) + Math.min(severity, 3),
      lineCap: "round",
      lineJoin: "round",
    }),
  }));
}

function cellStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(feature.get("age_minutes") ?? 0));
  const hail = Boolean(feature.get("hail_ever"));
  const mark = badge(feature);
  const colour = severityColour(severity);
  const picked = isSelected(feature);
  return cached(`cell:${severity}:${opacity}:${hail}:${mark}:${picked}`, () => new Style({
    image: new Circle({
      radius: (picked ? 8 : 6) + 2 * Math.min(severity, 3),
      fill: new Fill({ color: rgba(colour, (picked ? 1 : 0.75) * opacity) }),
      stroke: new Stroke({
        // The open popup's own cell, ringed so it is findable among the rest.
        color: hail ? rgba("#e03131", opacity) : rgba("#ffffff", opacity),
        width: picked ? 3.5 : (hail ? 3 : 1.5),
      }),
    }),
    text: mark
      ? new Text({
        text: mark,
        font: "bold 13px sans-serif",
        offsetY: -16,
        fill: new Fill({ color: rgba(colour, opacity) }),
        stroke: new Stroke({ color: rgba("#ffffff", opacity), width: 3 }),
      })
      : undefined,
  }));
}

/** Whether this feature belongs to the cell whose popup is open. */
const isSelected = (feature: FeatureLike): boolean => (
  selectedCode !== null && feature.get("code") === selectedCode
);

/**
 * The casing every forecast mark is drawn over.
 *
 * A one-pixel line in a mid-tone colour has nothing to hold on to here. The
 * basemap runs from near-white farmland to grey-green forest to pale blue sea
 * and back within the span of a single ellipse, and the radar's own greens and
 * yellows sit on top of that; a thin orange dash crosses all of it and is
 * legible against roughly none of it. A casing underneath gives it one
 * background instead of a dozen, which is what makes the line readable
 * wherever it happens to fall rather than only over the pale parts.
 *
 * Neither is fully opaque, because the casing is laid over the radar these
 * marks exist to be compared against, and there is a lot of it: a dozen nested
 * ellipses bunch up near the cell, and at full strength their casings merge
 * into a smear exactly where the storm is.
 *
 * The colour follows the basemap, which is the one piece of theming in this
 * layer and earns it. White casing on the dark map was tried and inverts the
 * mark: twelve bright rings become the loudest thing on the map and the
 * severity colour is reduced to a thin core inside them, so the one piece of
 * information the ring carries besides its shape stops being readable. A halo
 * is supposed to be the background, not a second mark.
 */
const LIGHT_CASING = "rgba(255, 255, 255, 0.75)";
const DARK_CASING = "rgba(12, 16, 22, 0.75)";

/** The basemaps a light casing would be the loudest thing on. */
const DARK_BASEMAPS = new Set(["dark", "satellite"]);

/**
 * The casing colour in force, kept beside `selectedCode` and for the same
 * reason: a style function is called per feature per frame with nowhere to
 * thread state through it.
 */
let casing = LIGHT_CASING;

/**
 * The dash the cone is drawn with.
 *
 * Shared by the casing so the two line up exactly -- a casing drawn solid
 * would put a continuous white ring on the map and lose the dashes entirely,
 * which is the opposite of the point. Longer than the 4/4 it replaces, too:
 * at that length and one pixel wide the ring read as a row of dots, and dots
 * are what the forecast centroids are.
 */
const ELLIPSE_DASH = [7, 5];

function forecastStyle(feature: FeatureLike): Style | undefined {
  if (!isSelected(feature)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  return cached(`forecast:${severity}:${casing}`, () => new Style({
    image: new Circle({
      radius: 3,
      fill: new Fill({ color: rgba(severityColour(severity), 0.95) }),
      // The same casing as the ellipses, as a ring rather than a halo: these
      // dots sit inside the cone and land on the same varied background.
      stroke: new Stroke({ color: casing, width: 1.5 }),
    }),
  }));
}

/**
 * The cone of uncertainty, as a cased outline.
 *
 * Filled, several overlapping cones turn a region of the map into a flat wash
 * and hide the radar under them, which is the one thing a chaser is comparing
 * the track against. So it stays an outline, and what makes it legible is the
 * casing under each dash rather than any weight added to the ring itself.
 *
 * Two styles, drawn in order: the wider light line first, the severity colour
 * over it. The colour is also close to opaque now. At 0.45 it was being asked
 * to carry the mark on its own and could not -- a translucent thin line takes
 * whatever is beneath it, which is the problem rather than the solution.
 */
function ellipseStyle(feature: FeatureLike): Style[] | undefined {
  if (!isSelected(feature)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  return cached(`ellipse:${severity}:${casing}`, () => [
    new Style({
      stroke: new Stroke({ color: casing, width: 4, lineDash: ELLIPSE_DASH }),
    }),
    new Style({
      stroke: new Stroke({
        color: rgba(severityColour(severity), 0.95),
        width: 2,
        lineDash: ELLIPSE_DASH,
      }),
    }),
  ]);
}

/**
 * The core, and only while it still describes something.
 *
 * Two things made this the most misread mark on the map. It fades now, like
 * the path and the centroid do -- it was the one feature drawn at full
 * strength however old it was, so a cell that dissipated an hour ago kept a
 * confident ring over empty radar while everything else about it had gone
 * pale. And past `OUTLINE_MAX_MINUTES` it is dropped outright.
 *
 * What remains is still not the edge of what the radar layer paints, and
 * cannot be: DWD contours the cell at its own detection threshold -- the
 * structure that comes with it bottoms out at 30 dBZ, and in practice the
 * footprint there is the same one as at 40 -- while the reflectivity layer
 * colours everything from -32.5 dBZ up. So a correct outline is a small ring
 * around the core, well inside the visible blob, never around it.
 */
function outlineStyle(feature: FeatureLike): Style | undefined {
  const minutes = feature.get("age_minutes") ?? 0;
  if (!outlineIsCurrent(minutes)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(minutes));
  return cached(`outline:${severity}:${opacity}`, () => new Style({
    stroke: new Stroke({ color: rgba(severityColour(severity), 0.6 * opacity), width: 1.5 }),
  }));
}

const STYLES: Record<CellFeatureKind, (feature: FeatureLike) => Style | Style[] | undefined> = {
  path: pathStyle,
  cell: cellStyle,
  outline: outlineStyle,
  forecast: forecastStyle,
  ellipse: ellipseStyle,
};

/** The feature source, and the layer that draws it. */
export default function makeCellLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  const layer = new VectorLayer({
    source,
    // Above the mesocyclone markers at 201: a tracked cell carries the same
    // rotation information with the storm's history attached.
    zIndex: 202,
    style: (feature: FeatureLike) => {
      const style = STYLES[feature.get("kind") as CellFeatureKind];
      return style ? style(feature) : undefined;
    },
  });

  selectedCell.subscribe((track) => {
    const code = track?.code ?? null;
    if (code === selectedCode) return;
    selectedCode = code;
    layer.changed();
  });

  /* Same shape as the selection above, and needed for the same reason: the
     cache is keyed on the casing, so switching basemaps builds the other set
     of styles rather than reusing the ones the old map wanted. */
  mapBaseLayer.subscribe((name) => {
    const next = DARK_BASEMAPS.has(name) ? DARK_CASING : LIGHT_CASING;
    if (next === casing) return;
    casing = next;
    layer.changed();
  });

  return [source, layer];
}

export { severityColour, ageOpacity };
