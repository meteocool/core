import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Circle from "ol/style/Circle";
import Text from "ol/style/Text";
import Point from "ol/geom/Point";
import type { FeatureLike } from "ol/Feature";
import { selectedCell } from "../stores";
import { LIGHT_CASING, watchCasing } from "./casing";
import { leadLabel, outlineIsCurrent } from "../lib/cellGeometry";

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

export type CellFeatureKind = "path" | "link" | "cell" | "outline" | "forecast" | "ellipse";

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

/**
 * A split or a merge, drawn as the gap it is.
 *
 * The join is a real continuation and has to read as one, or the map is back
 * to two unrelated lines; it is also the one segment of a track that was never
 * observed. DWD ends a code and starts another, and nothing was detected in
 * between -- the line only says which detections belong to the same storm.
 *
 * So: the colour and the fade of the track it leads into, which is what makes
 * it read as the same storm carrying on, and dotted rather than drawn, which
 * is what keeps it from being read as a fifth of an hour of positions nobody
 * ever measured. Thinner than a path for the same reason.
 *
 * Lit from either end. The joins belong as much to the cell that ended as to
 * the one that carries on, and a reader who opens the parent is asking
 * exactly what became of it.
 */
function linkStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(feature.get("age_minutes") ?? 0));
  const picked = isSelected(feature) || feature.get("from_code") === selectedCode;
  return cached(`link:${severity}:${opacity}:${picked}`, () => new Style({
    stroke: new Stroke({
      color: rgba(severityColour(severity), picked ? 0.95 : 0.7 * opacity),
      width: (picked ? 2.5 : 1.5) + Math.min(severity, 3) * 0.5,
      lineCap: "round",
      lineJoin: "round",
      // A dotted line rather than a dashed one: the gaps are most of it, so
      // the join reads as the steps nobody measured rather than as a path.
      lineDash: [1, 6],
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
 * The colour follows the basemap; the rule, and why it has to, is in
 * layers/casing.ts, which the live-cell ring shares.
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

/**
 * How often the lead labels are recomputed while a cell is selected.
 *
 * They are rounded to the minute, so this is how wrong one is allowed to be:
 * fifteen seconds, which is under the rounding and far under the minute the
 * reader is being told about.
 */
const LABEL_TICK_MS = 15_000;

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
/**
 * How long until the storm gets here, written on the ring's leading edge.
 *
 * Without it the cone is a dozen rings that plainly mean something about time
 * and do not say what: whether the outermost is ten minutes out or three hours
 * is the difference between watching a storm and having somewhere to be. The
 * label is the ring's own answer, placed where `leadingTip` put it -- the far
 * end of the major axis, where consecutive rings are furthest apart.
 *
 * ## Counted from now, not from the scan
 *
 * The number used to be the ring's lead over the last detection, which is the
 * forecast's own frame and the wrong one to put in front of a reader. Nothing
 * reaches the map the instant it happens: the radar scan, DWD's KONRAD3D run
 * behind it, the ingest behind that, and then however long the popup has been
 * open. By the time "+15 min" is read it routinely means eight, and a reader
 * deciding whether to bring the washing in acts on the number, not on the
 * pipeline.
 *
 * So the label counts down from the viewer's own clock. The cost is that the
 * sequence is no longer round -- +8, +23, +38 rather than +15, +30, +45 --
 * which looks like a bug and is the correction. Rings whose moment has already
 * passed lose their label and keep their outline: the cone is one shape and
 * punching holes in it would say the forecast had gaps.
 *
 * Only the lead time, not the uncertainty. These are DWD's 1-sigma Kalman
 * ellipses, so the honest reading of the outer ring is "about two chances in
 * three the centroid is inside this", and that is a sentence rather than a map
 * label. The popup's own "forecast to 17:15, +/-63.7 km" line is where the
 * width belongs.
 */
function leadLabelStyle(feature: FeatureLike, resolution: number): Style | undefined {
  const tip = feature.get("tip") as number[] | undefined;
  if (!tip) return undefined;
  const text = leadLabel(feature.get("forecast_at"), feature.get("lead_minutes"), resolution);
  if (text === null) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  return cached(`lead:${severity}:${casing}:${text}`, () => new Style({
    text: new Text({
      text,
      font: "600 11px sans-serif",
      fill: new Fill({ color: rgba(severityColour(severity), 1) }),
      // The casing the rings get, for the same reason and against the same
      // varied background.
      stroke: new Stroke({ color: casing, width: 3 }),
      offsetY: -9,
    }),
  })).clone();
}

function ellipseStyle(feature: FeatureLike, resolution: number): Style[] | undefined {
  if (!isSelected(feature)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  const label = leadLabelStyle(feature, resolution);
  if (label) label.setGeometry(new Point(feature.get("tip") as number[]));
  const rings = cached(`ellipse:${severity}:${casing}`, () => [
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
  return label ? [...rings, label] : rings;
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

const STYLES: Record<
  CellFeatureKind,
  (feature: FeatureLike, resolution: number) => Style | Style[] | undefined
> = {
  path: pathStyle,
  link: linkStyle,
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
    style: (feature: FeatureLike, resolution: number) => {
      const style = STYLES[feature.get("kind") as CellFeatureKind];
      return style ? style(feature, resolution) : undefined;
    },
  });

  /*
   * The lead labels count down from the viewer's clock, so they go stale on
   * their own -- OpenLayers keeps a layer's rendered output until something
   * invalidates it, and panning the map is not something a reader does while
   * reading a number off it.
   *
   * Only while a cell is selected, because that is the only time a ring is
   * drawn at all (see `ellipseStyle`), and redrawing this layer is not free:
   * it holds every feature of every track in the viewport. Once a selection is
   * open that is one relayout every fifteen seconds, against the twenty a
   * second the pulse was moved into its own layer to avoid.
   */
  let ticking: ReturnType<typeof setInterval> | null = null;

  selectedCell.subscribe((track) => {
    const code = track?.code ?? null;
    if (code === selectedCode) return;
    selectedCode = code;

    if (code && ticking === null) {
      ticking = setInterval(() => layer.changed(), LABEL_TICK_MS);
    } else if (!code && ticking !== null) {
      clearInterval(ticking);
      ticking = null;
    }

    layer.changed();
  });

  /* Same shape as the selection above, and needed for the same reason: the
     cache is keyed on the casing, so switching basemaps builds the other set
     of styles rather than reusing the ones the old map wanted. */
  watchCasing((next) => {
    casing = next;
    layer.changed();
  });

  return [source, layer];
}

export { severityColour, ageOpacity };
